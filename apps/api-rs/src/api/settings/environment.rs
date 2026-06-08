use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::api::common::timestamp;
use crate::db::Db;

use super::store::{load_json, save_json};

const SETTING_KEY: &str = "environment_overview";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentOverview {
    pub tools: Vec<EnvironmentToolRecord>,
    pub package_records: Vec<EnvironmentPackageRecord>,
    pub restore_runs: Vec<EnvironmentRestoreRun>,
    pub reconcile: Vec<EnvironmentReconcileItem>,
    pub project_usage: Vec<EnvironmentProjectUsage>,
    pub mise: MiseStatus,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentToolRecord {
    pub id: String,
    pub tool: String,
    pub requested_version: String,
    pub detected_version: Option<String>,
    pub is_global_default: Option<bool>,
    pub status: String,
    pub source: String,
    pub scope: String,
    pub auto_restore: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPackageRecord {
    pub id: String,
    pub tool_record_id: Option<String>,
    pub tool: String,
    pub runtime_version: Option<String>,
    pub ecosystem: String,
    pub manager: String,
    pub package_name: String,
    pub version_spec: Option<String>,
    pub installed_version: Option<String>,
    pub install_command: String,
    pub uninstall_command: Option<String>,
    pub target_label: String,
    pub scope: String,
    pub auto_restore: bool,
    pub persisted: bool,
    pub status: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentRestoreRun {
    pub id: String,
    pub status: String,
    pub summary: String,
    pub created_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReconcileItem {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub title: String,
    pub detail: String,
    pub tool_record_id: Option<String>,
    pub package_record_id: Option<String>,
    pub project_ids: Option<Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentProjectUsage {
    pub project_id: String,
    pub project_name: String,
    pub workspace_path: String,
    pub matched_tools: Vec<String>,
    pub detected_files: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct MiseStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub warning: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterEnvironmentToolRequest {
    pub tool: String,
    pub version: String,
    pub scope: Option<String>,
    pub auto_restore: Option<bool>,
    pub notes: Option<String>,
    pub detected_version: Option<String>,
    pub source: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentRestoreMissingRequest {
    pub mode: Option<String>,
    pub include_tools: Option<bool>,
    pub include_packages: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentRestorePreviewResponse {
    pub items: Vec<EnvironmentRestorePreviewItem>,
    pub tools: usize,
    pub packages: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentRestorePreviewItem {
    pub id: String,
    pub kind: String,
    pub action: String,
    pub title: String,
    pub detail: String,
    pub command: Option<String>,
    pub tool_record_id: Option<String>,
    pub package_record_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentToolProbe {
    pub tool: String,
    pub detected_version: Option<String>,
    pub installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentToolRegistryResponse {
    pub items: Vec<EnvironmentToolRegistryItem>,
    pub mise: MiseStatus,
}

#[derive(Serialize)]
pub struct EnvironmentToolRegistryItem {
    pub name: String,
    pub description: Option<String>,
    pub backend: Option<String>,
}

pub fn overview(db: &Db) -> anyhow::Result<EnvironmentOverview> {
    let mut overview =
        load_json::<EnvironmentOverview>(db, SETTING_KEY)?.unwrap_or_else(default_overview);
    overview.mise = detect_mise_status();
    refresh_tool_detection(&mut overview);
    overview.updated_at = timestamp();
    save_json(db, SETTING_KEY, &overview)?;
    Ok(overview)
}

pub fn register_tool(
    db: &Db,
    input: RegisterEnvironmentToolRequest,
) -> anyhow::Result<EnvironmentOverview> {
    let tool = input.tool.trim();
    let version = input.version.trim();
    if tool.is_empty() || version.is_empty() {
        anyhow::bail!("invalid_environment_tool");
    }
    let mut overview = overview(db)?;
    let now = timestamp();
    let detected_version = input.detected_version.or_else(|| detect_tool_version(tool));
    let status = status_for(version, detected_version.as_deref());
    let id = format!("env-tool-{}-{}", slug(tool), slug(version));
    let record = EnvironmentToolRecord {
        id: id.clone(),
        tool: tool.to_string(),
        requested_version: version.to_string(),
        detected_version,
        is_global_default: Some(false),
        status,
        source: normalize_source(input.source.as_deref()),
        scope: normalize_scope(input.scope.as_deref()),
        auto_restore: input.auto_restore.unwrap_or(true),
        notes: input.notes.and_then(clean_optional),
        created_at: now.clone(),
        updated_at: now,
    };
    if let Some(existing) = overview.tools.iter_mut().find(|item| item.id == id) {
        *existing = record;
    } else {
        overview.tools.insert(0, record);
    }
    overview.updated_at = timestamp();
    save_json(db, SETTING_KEY, &overview)?;
    Ok(overview)
}

pub fn delete_tool(db: &Db, id: &str) -> anyhow::Result<EnvironmentOverview> {
    let mut overview = overview(db)?;
    overview.tools.retain(|item| item.id != id);
    overview
        .package_records
        .retain(|item| item.tool_record_id.as_deref() != Some(id));
    overview.updated_at = timestamp();
    save_json(db, SETTING_KEY, &overview)?;
    Ok(overview)
}

pub fn set_default_tool(db: &Db, id: &str) -> anyhow::Result<EnvironmentOverview> {
    let mut overview = overview(db)?;
    let Some(tool_name) = overview
        .tools
        .iter()
        .find(|item| item.id == id)
        .map(|item| item.tool.clone())
    else {
        anyhow::bail!("environment_tool_not_found");
    };
    for tool in &mut overview.tools {
        if tool.tool == tool_name {
            tool.is_global_default = Some(tool.id == id);
            tool.updated_at = timestamp();
        }
    }
    overview.updated_at = timestamp();
    save_json(db, SETTING_KEY, &overview)?;
    Ok(overview)
}

pub fn restore_preview(
    db: &Db,
    input: EnvironmentRestoreMissingRequest,
) -> anyhow::Result<EnvironmentRestorePreviewResponse> {
    let overview = overview(db)?;
    let include_tools = input.include_tools.unwrap_or(true);
    let include_packages = input.include_packages.unwrap_or(true);
    let only_auto = input.mode.as_deref() == Some("auto");
    let mut items = Vec::new();
    if include_tools {
        for tool in overview
            .tools
            .iter()
            .filter(|tool| tool.status != "installed" && (!only_auto || tool.auto_restore))
        {
            let action = if tool.source == "mise" {
                "install"
            } else {
                "manual"
            };
            let command = if action == "install" {
                Some(format!(
                    "mise use -g {}@{}",
                    tool.tool, tool.requested_version
                ))
            } else {
                None
            };
            items.push(EnvironmentRestorePreviewItem {
                id: format!("preview-tool-{}", tool.id),
                kind: "tool".to_string(),
                action: action.to_string(),
                title: format!("{}@{}", tool.tool, tool.requested_version),
                detail: if action == "install" {
                    "Runtime can be restored with mise.".to_string()
                } else {
                    "Runtime needs manual restore.".to_string()
                },
                command,
                tool_record_id: Some(tool.id.clone()),
                package_record_id: None,
            });
        }
    }
    if include_packages {
        for package in overview.package_records.iter().filter(|package| {
            package.status.as_deref() != Some("installed") && (!only_auto || package.auto_restore)
        }) {
            items.push(EnvironmentRestorePreviewItem {
                id: format!("preview-package-{}", package.id),
                kind: "package".to_string(),
                action: "install".to_string(),
                title: package.package_name.clone(),
                detail: format!("Install with {}.", package.manager),
                command: Some(package.install_command.clone()),
                tool_record_id: package.tool_record_id.clone(),
                package_record_id: Some(package.id.clone()),
            });
        }
    }
    let tools = items.iter().filter(|item| item.kind == "tool").count();
    let packages = items.iter().filter(|item| item.kind == "package").count();
    Ok(EnvironmentRestorePreviewResponse {
        items,
        tools,
        packages,
    })
}

pub fn restore_missing(
    db: &Db,
    input: EnvironmentRestoreMissingRequest,
) -> anyhow::Result<EnvironmentOverview> {
    let preview = restore_preview(db, input)?;
    let mut success = 0usize;
    let mut failed = 0usize;
    for item in preview.items.iter().filter(|item| item.action == "install") {
        let Some(command) = item
            .command
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        else {
            continue;
        };
        let status = Command::new("/bin/sh").arg("-lc").arg(command).status();
        match status {
            Ok(status) if status.success() => success += 1,
            _ => failed += 1,
        }
    }
    let mut overview = overview(db)?;
    let status = if failed == 0 {
        "success"
    } else if success > 0 {
        "partial"
    } else {
        "failed"
    };
    overview.restore_runs.insert(
        0,
        EnvironmentRestoreRun {
            id: format!("env-restore-{}", random_hex(16)),
            status: status.to_string(),
            summary: format!(
                "Restored {success}/{} missing environment items.",
                success + failed
            ),
            created_at: timestamp(),
        },
    );
    overview.restore_runs.truncate(20);
    overview.updated_at = timestamp();
    save_json(db, SETTING_KEY, &overview)?;
    Ok(overview)
}

pub fn probe_tool(tool: &str) -> EnvironmentToolProbe {
    let detected_version = detect_tool_version(tool);
    EnvironmentToolProbe {
        tool: tool.to_string(),
        installed: detected_version.is_some(),
        detected_version,
    }
}

pub fn registry(query: Option<&str>) -> EnvironmentToolRegistryResponse {
    let trimmed = query.unwrap_or("").trim();
    let args: Vec<&str> = if trimmed.is_empty() {
        vec!["registry"]
    } else {
        vec!["search", trimmed]
    };
    if let Ok(output) = Command::new(resolve_mise_command()).args(args).output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).to_string()
                + &String::from_utf8_lossy(&output.stderr);
            let mut items = parse_registry_lines(&text);
            items.truncate(if trimmed.is_empty() { 400 } else { 100 });
            return EnvironmentToolRegistryResponse {
                items,
                mise: detect_mise_status(),
            };
        }
    }

    let all = fallback_registry_items();
    let needle = query.unwrap_or("").trim().to_lowercase();
    let items = all
        .into_iter()
        .filter(|(name, description, _)| {
            needle.is_empty()
                || name.contains(&needle)
                || description.to_lowercase().contains(&needle)
        })
        .map(|(name, description, backend)| EnvironmentToolRegistryItem {
            name: name.to_string(),
            description: Some(description.to_string()),
            backend: Some(backend.to_string()),
        })
        .collect();
    EnvironmentToolRegistryResponse {
        items,
        mise: detect_mise_status(),
    }
}

// ---------------------------------------------------------------------------
// Additional environment models for tool versions / packages / bulk actions.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentToolVersionItem {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentToolVersionsResponse {
    pub items: Vec<EnvironmentToolVersionItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<Vec<EnvironmentToolVersionItem>>,
    pub error: Option<String>,
    pub mise: MiseStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPackageManagerOption {
    pub id: String,
    pub label: String,
    pub install_command_example: String,
    pub uninstall_command_example: String,
    pub supported: bool,
    pub detected_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPackageDetailResponse {
    pub tool_record: EnvironmentToolRecord,
    pub packages: Vec<EnvironmentPackageRecord>,
    pub managers: Vec<EnvironmentPackageManagerOption>,
    pub restore_preview: Vec<EnvironmentRestorePreviewItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallEnvironmentToolRequest {
    pub tool: Option<String>,
    pub version: Option<String>,
    pub scope: Option<String>,
    pub auto_restore: Option<bool>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallEnvironmentPackageRequest {
    pub tool_record_id: Option<String>,
    pub manager: Option<String>,
    pub package_name: Option<String>,
    pub version_spec: Option<String>,
    pub notes: Option<String>,
    pub auto_restore: Option<bool>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallEnvironmentPackageRequest {
    pub manager: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentBulkActionRequest {
    pub action: Option<String>,
    pub tool_record_id: Option<String>,
    #[serde(default)]
    pub package_ids: Option<Vec<String>>,
}

// ---------------------------------------------------------------------------
// mise install
// ---------------------------------------------------------------------------

/// Mirrors installMise in apps/api/src/environment/index.ts: download & install mise to
/// $HOME/.local/bin and record a restore run. Errors bubble up so the route can rebuild the
/// overview and report `mise_install_failed`.
pub fn install_mise(db: &Db) -> anyhow::Result<EnvironmentOverview> {
    let home = std::env::var("HOME").map_err(|_| anyhow::anyhow!("home_not_available"))?;
    let install_path = format!("{home}/.local/bin/mise");
    let install_script = [
        "set -euo pipefail",
        "mkdir -p \"$HOME/.local/bin\"",
        "tmp=\"$(mktemp)\"",
        "trap 'rm -f \"$tmp\"' EXIT",
        "curl -fsSL https://mise.run -o \"$tmp\"",
        "MISE_INSTALL_PATH=\"$HOME/.local/bin/mise\" sh \"$tmp\"",
        "\"$HOME/.local/bin/mise\" --version",
    ]
    .join(" && ");
    let result = Command::new("/bin/bash")
        .arg("-lc")
        .arg(&install_script)
        .output();
    let verification = Command::new(&install_path).arg("--version").output();
    let installed = matches!(&result, Ok(out) if out.status.success())
        && matches!(&verification, Ok(out) if out.status.success());

    let mut overview = overview(db)?;
    let summary = if installed {
        format!("Installed mise to {install_path}")
    } else {
        command_failure_detail(&result, &verification)
            .unwrap_or_else(|| "Failed to install mise".to_string())
    };
    push_restore_run(
        &mut overview,
        if installed { "success" } else { "failed" },
        summary.clone(),
    );
    save_json(db, SETTING_KEY, &overview)?;
    if !installed {
        anyhow::bail!(summary);
    }
    Ok(overview)
}

// ---------------------------------------------------------------------------
// tool versions
// ---------------------------------------------------------------------------

/// Mirrors listEnvironmentToolVersions: `mise ls-remote <tool>` parsed into version items with a
/// recommended subset.
pub fn list_tool_versions(tool: &str) -> EnvironmentToolVersionsResponse {
    let trimmed = tool.trim();
    if trimmed.is_empty() {
        return EnvironmentToolVersionsResponse {
            items: Vec::new(),
            history: None,
            error: Some("tool_required".to_string()),
            mise: detect_mise_status(),
        };
    }
    let mise = resolve_mise_command();
    let output = Command::new(&mise).arg("ls-remote").arg(trimmed).output();
    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).to_string()
                + &String::from_utf8_lossy(&out.stderr);
            let mut items: Vec<EnvironmentToolVersionItem> = text
                .lines()
                .map(str::trim)
                .filter(|line| {
                    !line.is_empty()
                        && !line.starts_with("[WARN]")
                        && !line.starts_with("mise WARN")
                })
                .filter_map(|line| {
                    line.split_whitespace()
                        .next()
                        .map(|version| EnvironmentToolVersionItem {
                            version: version.to_string(),
                            recommended: None,
                        })
                })
                .collect();
            items.sort_by(|a, b| compare_semver_desc(&a.version, &b.version));
            let recommended = recommend_versions(trimmed, &items);
            let history: Vec<EnvironmentToolVersionItem> = items
                .into_iter()
                .filter(|item| {
                    !recommended
                        .iter()
                        .any(|entry| entry.version == item.version)
                })
                .take(80)
                .collect();
            EnvironmentToolVersionsResponse {
                items: recommended,
                history: Some(history),
                error: None,
                mise: detect_mise_status(),
            }
        }
        Ok(out) => {
            let detail = (String::from_utf8_lossy(&out.stderr).to_string()
                + &String::from_utf8_lossy(&out.stdout))
                .trim()
                .to_string();
            EnvironmentToolVersionsResponse {
                items: Vec::new(),
                history: None,
                error: Some(if detail.is_empty() {
                    "environment_versions_failed".to_string()
                } else {
                    detail
                }),
                mise: detect_mise_status(),
            }
        }
        Err(error) => EnvironmentToolVersionsResponse {
            items: Vec::new(),
            history: Some(Vec::new()),
            error: Some(error.to_string()),
            mise: detect_mise_status(),
        },
    }
}

// ---------------------------------------------------------------------------
// tool install / uninstall
// ---------------------------------------------------------------------------

/// Mirrors installEnvironmentTool: `mise use -g <tool>@<version>`.
pub fn install_tool(
    db: &Db,
    body: InstallEnvironmentToolRequest,
) -> anyhow::Result<EnvironmentOverview> {
    let tool = body.tool.as_deref().unwrap_or("").trim().to_string();
    let version = body.version.as_deref().unwrap_or("").trim().to_string();
    if tool.is_empty() || version.is_empty() {
        anyhow::bail!("invalid_environment_tool");
    }
    let now = timestamp();
    let scope = normalize_scope(body.scope.as_deref());
    let install_result = run_mise_use_global(&tool, &format!("{tool}@{version}"));
    let detected_version = detect_tool_version(&tool);
    let success = matches!(&install_result, Ok(out) if out.status.success());
    let status = if success {
        if detected_version
            .as_deref()
            .map(|d| !d.contains(&version))
            .unwrap_or(false)
        {
            "version_mismatch"
        } else {
            "installed"
        }
    } else {
        "missing"
    };
    let record = EnvironmentToolRecord {
        id: format!("env-tool-{}", random_hex(8)),
        tool: tool.clone(),
        requested_version: version.clone(),
        detected_version,
        is_global_default: Some(false),
        status: status.to_string(),
        source: "mise".to_string(),
        scope: scope.clone(),
        auto_restore: body.auto_restore != Some(false),
        notes: body.notes.and_then(clean_optional),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let mut overview = overview(db)?;
    overview
        .tools
        .retain(|item| !(item.tool == record.tool && item.scope == record.scope));
    overview.tools.insert(0, record);
    overview.updated_at = now;
    save_json(db, SETTING_KEY, &overview)?;
    if !success {
        anyhow::bail!(command_output_detail(&install_result)
            .unwrap_or_else(|| "environment_tool_install_failed".to_string()));
    }
    Ok(overview)
}

/// Mirrors uninstallEnvironmentTool: `mise uninstall <tool>@<version>` for mise-sourced tools.
pub fn uninstall_tool(db: &Db, id: &str) -> anyhow::Result<EnvironmentOverview> {
    let mut overview = overview(db)?;
    let Some(tool) = overview.tools.iter().find(|item| item.id == id).cloned() else {
        anyhow::bail!("environment_tool_not_found");
    };
    if tool.source != "mise" {
        anyhow::bail!("environment_tool_uninstall_not_allowed");
    }
    let target = format!("{}@{}", tool.tool, tool.requested_version);
    let result = Command::new(resolve_mise_command())
        .arg("uninstall")
        .arg(&target)
        .output();
    let success = matches!(&result, Ok(out) if out.status.success());
    if success {
        overview.tools.retain(|item| item.id != id);
    }
    let summary = if success {
        format!("Uninstalled {target} via mise")
    } else {
        command_output_detail(&result).unwrap_or_else(|| format!("Failed to uninstall {target}"))
    };
    push_restore_run(
        &mut overview,
        if success { "success" } else { "failed" },
        summary.clone(),
    );
    save_json(db, SETTING_KEY, &overview)?;
    if !success {
        anyhow::bail!(summary);
    }
    Ok(overview)
}

// ---------------------------------------------------------------------------
// packages
// ---------------------------------------------------------------------------

/// Mirrors getEnvironmentToolPackages + recordDetectedPackages semantics: gather persisted DB
/// records first, then merge in detected (scanned) packages that are not already recorded,
/// deduped by (manager, package_name) preferring the persisted DB record.
pub fn tool_packages(db: &Db, id: &str) -> anyhow::Result<EnvironmentPackageDetailResponse> {
    let overview = overview(db)?;
    let Some(tool_record) = overview.tools.iter().find(|item| item.id == id).cloned() else {
        anyhow::bail!("environment_tool_not_found");
    };
    let recorded: Vec<EnvironmentPackageRecord> = overview
        .package_records
        .iter()
        .filter(|pkg| pkg.tool_record_id.as_deref() == Some(id))
        .cloned()
        .collect();

    let mut seen: std::collections::HashSet<(String, String)> = recorded
        .iter()
        .map(|pkg| (pkg.manager.clone(), pkg.package_name.clone()))
        .collect();

    // Recorded packages first, then detected ones not already recorded.
    let mut packages = recorded;
    for detected in scan_environment_packages(&tool_record) {
        let key = (detected.manager.clone(), detected.package_name.clone());
        if seen.insert(key) {
            packages.push(detected);
        }
    }

    let managers = list_package_managers(&tool_record.tool);
    Ok(EnvironmentPackageDetailResponse {
        tool_record,
        packages,
        managers,
        restore_preview: Vec::new(),
    })
}

/// Mirrors inspectEnvironmentPackage probe route: actually probe via the manager's inspect handler.
pub fn inspect_package(manager: &str, package_name: &str) -> serde_json::Value {
    let pkg = package_name.trim();
    if pkg.is_empty() {
        return serde_json::json!({ "installed": false, "version": serde_json::Value::Null, "manager": manager, "packageName": package_name });
    }
    let (installed, version) = inspect_environment_package(manager, pkg);
    serde_json::json!({
        "installed": installed,
        "version": version,
        "manager": manager,
        "packageName": package_name,
    })
}

/// Mirrors installEnvironmentPackage: build the manager-specific install command and shell out.
pub fn install_package(
    db: &Db,
    body: InstallEnvironmentPackageRequest,
) -> anyhow::Result<EnvironmentOverview> {
    let tool_record_id = body.tool_record_id.as_deref().unwrap_or("").to_string();
    let manager = body.manager.as_deref().unwrap_or("").trim().to_string();
    let package_name = body
        .package_name
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if tool_record_id.is_empty() || package_name.is_empty() || manager.is_empty() {
        anyhow::bail!("invalid_environment_package");
    }
    let mut overview = overview(db)?;
    let Some(tool_record) = overview
        .tools
        .iter()
        .find(|item| item.id == tool_record_id)
        .cloned()
    else {
        anyhow::bail!("environment_tool_not_found");
    };
    let version_spec = body
        .version_spec
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let spec = match &version_spec {
        Some(version) => format!("{package_name}@{version}"),
        None => package_name.clone(),
    };
    let Some(command) = package_install_command(&manager, &package_name, version_spec.as_deref())
    else {
        anyhow::bail!("environment_package_manager_not_supported");
    };
    let result = run_mise_exec(&command.args);
    let success = matches!(&result, Ok(out) if out.status.success());
    let now = timestamp();
    let record = EnvironmentPackageRecord {
        id: format!("env-pkg-{}", random_hex(8)),
        tool_record_id: Some(tool_record.id.clone()),
        tool: tool_record.tool.clone(),
        runtime_version: Some(tool_record.requested_version.clone()),
        ecosystem: tool_record.tool.to_lowercase(),
        manager: manager.clone(),
        package_name: package_name.clone(),
        version_spec: version_spec.clone(),
        installed_version: version_spec.clone(),
        install_command: command.text.clone(),
        uninstall_command: package_uninstall_command(&manager, &package_name).map(|cmd| cmd.text),
        target_label: format!("{}@{}", tool_record.tool, tool_record.requested_version),
        scope: "global".to_string(),
        auto_restore: body.auto_restore != Some(false),
        persisted: success,
        status: Some(if success { "installed" } else { "failed" }.to_string()),
        notes: body.notes.and_then(clean_optional),
        created_at: now.clone(),
        updated_at: Some(now.clone()),
    };
    overview.package_records.retain(|item| {
        !(item.tool_record_id.as_deref() == Some(tool_record.id.as_str())
            && item.manager == manager
            && item.package_name == package_name)
    });
    overview.package_records.insert(0, record);
    let summary = if success {
        format!(
            "Installed {spec} for {}@{} via {manager}",
            tool_record.tool, tool_record.requested_version
        )
    } else {
        command_output_detail(&result).unwrap_or_else(|| format!("Failed to install {spec}"))
    };
    push_restore_run(
        &mut overview,
        if success { "success" } else { "failed" },
        summary.clone(),
    );
    overview.updated_at = now;
    save_json(db, SETTING_KEY, &overview)?;
    if !success {
        anyhow::bail!(summary);
    }
    Ok(overview)
}

/// Mirrors uninstallEnvironmentPackage.
pub fn uninstall_package(
    db: &Db,
    id: &str,
    manager_override: Option<&str>,
) -> anyhow::Result<EnvironmentOverview> {
    let mut overview = overview(db)?;
    let Some(pkg) = overview
        .package_records
        .iter()
        .find(|item| item.id == id)
        .cloned()
    else {
        anyhow::bail!("environment_package_not_found");
    };
    let manager = manager_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(pkg.manager.as_str())
        .to_string();
    let Some(command) = package_uninstall_command(&manager, &pkg.package_name) else {
        anyhow::bail!("environment_package_manager_not_supported");
    };
    let result = run_mise_exec(&command.args);
    let success = matches!(&result, Ok(out) if out.status.success());
    let now = timestamp();
    if success {
        overview.package_records.retain(|item| item.id != id);
    } else if let Some(item) = overview
        .package_records
        .iter_mut()
        .find(|item| item.id == id)
    {
        item.status = Some("failed".to_string());
        item.updated_at = Some(now.clone());
    }
    let summary = if success {
        format!(
            "Uninstalled {} from {} via {manager}",
            pkg.package_name, pkg.target_label
        )
    } else {
        command_output_detail(&result)
            .unwrap_or_else(|| format!("Failed to uninstall {}", pkg.package_name))
    };
    push_restore_run(
        &mut overview,
        if success { "success" } else { "failed" },
        summary.clone(),
    );
    overview.updated_at = now;
    save_json(db, SETTING_KEY, &overview)?;
    if !success {
        anyhow::bail!(summary);
    }
    Ok(overview)
}

// ---------------------------------------------------------------------------
// bulk actions
// ---------------------------------------------------------------------------

/// Mirrors POST /api/settings/environment/bulk. Package scanning is available in the Rust port,
/// so record_detected_packages persists newly scanned packages and install_missing_packages acts on
/// missing persisted records just like the TS implementation.
pub fn bulk_action(
    db: &Db,
    body: EnvironmentBulkActionRequest,
) -> anyhow::Result<EnvironmentOverview> {
    let Some(action) = body.action.as_deref() else {
        anyhow::bail!("invalid_environment_bulk_action");
    };
    let now = timestamp();
    if action == "cleanup_stale_records" {
        let mut overview = overview(db)?;
        let before = overview.package_records.len();
        overview
            .package_records
            .retain(|pkg| pkg.status.as_deref() != Some("missing"));
        let removed = before - overview.package_records.len();
        push_restore_run(
            &mut overview,
            "success",
            format!("Cleaned up {removed} stale package records"),
        );
        overview.updated_at = now;
        save_json(db, SETTING_KEY, &overview)?;
        return Ok(overview);
    }
    let mut overview = overview(db)?;
    let Some(tool_record_id) = body.tool_record_id.as_deref() else {
        anyhow::bail!("environment_tool_not_found");
    };
    let Some(tool_record) = overview
        .tools
        .iter()
        .find(|item| item.id == tool_record_id)
        .cloned()
    else {
        anyhow::bail!("environment_tool_not_found");
    };
    match action {
        "record_detected_packages" => {
            let recorded_keys: std::collections::HashSet<(String, String)> = overview
                .package_records
                .iter()
                .filter(|pkg| pkg.tool_record_id.as_deref() == Some(tool_record.id.as_str()))
                .map(|pkg| (pkg.manager.clone(), pkg.package_name.clone()))
                .collect();
            let mut detected_packages: Vec<EnvironmentPackageRecord> =
                scan_environment_packages(&tool_record)
                    .into_iter()
                    .filter(|pkg| {
                        !recorded_keys.contains(&(pkg.manager.clone(), pkg.package_name.clone()))
                    })
                    .collect();
            let detected_count = detected_packages.len();
            for pkg in &mut detected_packages {
                pkg.id = format!("env-pkg-{}", random_hex(16));
                pkg.persisted = true;
                pkg.updated_at = Some(now.clone());
            }
            overview.package_records.splice(0..0, detected_packages);
            push_restore_run(
                &mut overview,
                "success",
                format!(
                    "Recorded {detected_count} detected packages for {}@{}",
                    tool_record.tool, tool_record.requested_version
                ),
            );
            overview.updated_at = now;
            save_json(db, SETTING_KEY, &overview)?;
            Ok(overview)
        }
        "install_missing_packages" => {
            let package_id_set: std::collections::HashSet<String> =
                body.package_ids.unwrap_or_default().into_iter().collect();
            let targets: Vec<EnvironmentPackageRecord> = overview
                .package_records
                .iter()
                .filter(|pkg| {
                    pkg.tool_record_id.as_deref() == Some(tool_record.id.as_str())
                        && pkg.status.as_deref() == Some("missing")
                        && (package_id_set.is_empty() || package_id_set.contains(&pkg.id))
                })
                .cloned()
                .collect();
            let mut success_count = 0usize;
            for pkg in &targets {
                let Some(command) = package_install_command(
                    &pkg.manager,
                    &pkg.package_name,
                    pkg.version_spec.as_deref(),
                ) else {
                    continue;
                };
                if matches!(run_mise_exec(&command.args), Ok(out) if out.status.success()) {
                    success_count += 1;
                    if let Some(item) = overview
                        .package_records
                        .iter_mut()
                        .find(|item| item.id == pkg.id)
                    {
                        item.status = Some("installed".to_string());
                        item.persisted = true;
                        item.updated_at = Some(now.clone());
                    }
                }
            }
            let status = if success_count == targets.len() {
                "success"
            } else if success_count > 0 {
                "partial"
            } else {
                "failed"
            };
            push_restore_run(
                &mut overview,
                status,
                format!(
                    "Installed {success_count}/{} missing packages for {}@{}",
                    targets.len(),
                    tool_record.tool,
                    tool_record.requested_version
                ),
            );
            overview.updated_at = now;
            save_json(db, SETTING_KEY, &overview)?;
            Ok(overview)
        }
        _ => anyhow::bail!("environment_bulk_action_not_supported"),
    }
}

// ---------------------------------------------------------------------------
// restore runs
// ---------------------------------------------------------------------------

pub fn delete_restore_run(db: &Db, id: &str) -> anyhow::Result<EnvironmentOverview> {
    let mut overview = overview(db)?;
    overview.restore_runs.retain(|item| item.id != id);
    overview.updated_at = timestamp();
    save_json(db, SETTING_KEY, &overview)?;
    Ok(overview)
}

pub fn clear_restore_runs(db: &Db) -> anyhow::Result<EnvironmentOverview> {
    let mut overview = overview(db)?;
    overview.restore_runs.clear();
    overview.updated_at = timestamp();
    save_json(db, SETTING_KEY, &overview)?;
    Ok(overview)
}

fn default_overview() -> EnvironmentOverview {
    EnvironmentOverview {
        tools: Vec::new(),
        package_records: Vec::new(),
        restore_runs: Vec::new(),
        reconcile: Vec::new(),
        project_usage: Vec::new(),
        mise: detect_mise_status(),
        updated_at: timestamp(),
    }
}

fn refresh_tool_detection(overview: &mut EnvironmentOverview) {
    for tool in &mut overview.tools {
        let detected = detect_tool_version(&tool.tool);
        tool.detected_version = detected.clone();
        tool.status = status_for(&tool.requested_version, detected.as_deref());
    }
}

pub fn detect_mise_status() -> MiseStatus {
    match command_output(&resolve_mise_command(), &["--version"]) {
        Some(version) => MiseStatus {
            installed: true,
            version: Some(version),
            warning: None,
        },
        None => MiseStatus {
            installed: false,
            version: None,
            warning: Some("mise_not_installed".to_string()),
        },
    }
}

fn detect_tool_version(tool: &str) -> Option<String> {
    let key = tool.trim().to_lowercase();
    match key.as_str() {
        "python" | "python3" => command_output("python3", &["--version"])
            .or_else(|| command_output("python", &["--version"]))
            .or_else(|| mise_exec_version("python", &["--version"])),
        "node" => command_output("node", &["-v"]).or_else(|| mise_exec_version("node", &["-v"])),
        "pnpm" => command_output("pnpm", &["-v"]).or_else(|| mise_exec_version("pnpm", &["-v"])),
        "git" => command_output("git", &["--version"])
            .or_else(|| mise_exec_version("git", &["--version"])),
        "uv" => {
            command_output("uv", &["--version"]).or_else(|| mise_exec_version("uv", &["--version"]))
        }
        "ffmpeg" => command_output("ffmpeg", &["-version"])
            .or_else(|| mise_exec_version("ffmpeg", &["-version"])),
        "go" => {
            command_output("go", &["version"]).or_else(|| mise_exec_version("go", &["version"]))
        }
        "bun" => command_output("bun", &["--version"])
            .or_else(|| mise_exec_version("bun", &["--version"])),
        "rust" => command_output("rustc", &["--version"]),
        "mise" => command_output(&resolve_mise_command(), &["--version"]),
        other => command_output(other, &["--version"])
            .or_else(|| command_output(other, &["version"]))
            .or_else(|| mise_exec_version(other, &["--version"]))
            .or_else(|| mise_exec_version(other, &["version"])),
    }
}

fn mise_exec_version(command: &str, args: &[&str]) -> Option<String> {
    let mut command_args = vec!["exec", "--", command];
    command_args.extend(args.iter().copied());
    command_output(&resolve_mise_command(), &command_args)
}

fn parse_registry_lines(output: &str) -> Vec<EnvironmentToolRegistryItem> {
    output
        .lines()
        .map(str::trim_end)
        .filter(|line| {
            !line.trim().is_empty() && !line.starts_with("[WARN]") && !line.starts_with("mise WARN")
        })
        .filter_map(|line| {
            let mut parts = line.splitn(2, char::is_whitespace);
            let name = parts.next()?.trim();
            if name.is_empty() {
                return None;
            }
            let rest = parts.next().unwrap_or("").trim();
            let backend = rest
                .split_whitespace()
                .next()
                .filter(|value| !value.is_empty());
            Some(EnvironmentToolRegistryItem {
                name: name.to_string(),
                description: if rest.is_empty() {
                    None
                } else {
                    Some(rest.to_string())
                },
                backend: backend.map(ToString::to_string),
            })
        })
        .collect()
}

fn fallback_registry_items() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("node", "Node.js JavaScript runtime", "core"),
        ("python", "Python runtime", "core"),
        ("go", "Go runtime", "core"),
        ("rust", "Rust toolchain", "core"),
        ("uv", "Python package and tool manager", "external"),
        ("pnpm", "Node package manager", "external"),
        ("bun", "Bun JavaScript runtime", "external"),
        ("ffmpeg", "Audio/video processing toolkit", "external"),
        ("git", "Git version control", "system"),
    ]
}

fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string()
        + &String::from_utf8_lossy(&output.stderr);
    text.lines()
        .map(str::trim)
        .find(|line| {
            !line.is_empty() && !line.starts_with("[WARN]") && !line.starts_with("mise WARN")
        })
        .map(ToString::to_string)
}

fn status_for(requested_version: &str, detected_version: Option<&str>) -> String {
    let Some(detected) = detected_version else {
        return "missing".to_string();
    };
    if detected.contains(requested_version) || requested_version == "latest" {
        "installed".to_string()
    } else {
        "version_mismatch".to_string()
    }
}

fn normalize_scope(value: Option<&str>) -> String {
    match value.unwrap_or("global") {
        "workspace" => "workspace",
        "room" => "room",
        "session" => "session",
        _ => "global",
    }
    .to_string()
}

fn normalize_source(value: Option<&str>) -> String {
    match value.unwrap_or("manual") {
        "mise" => "mise",
        "system" => "system",
        "external" => "external",
        _ => "manual",
    }
    .to_string()
}

fn clean_optional(value: String) -> Option<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
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

fn random_hex(size: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; size];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// ---------------------------------------------------------------------------
// command construction helpers (mirror apps/api/src/environment/packages.ts)
// ---------------------------------------------------------------------------

struct PackageCommand {
    args: Vec<String>,
    text: String,
}

fn resolve_mise_command() -> String {
    let home = std::env::var("HOME").ok();
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(value) = std::env::var("MISE_BIN") {
        candidates.push(value);
    }
    if let Ok(value) = std::env::var("MISE_PATH") {
        candidates.push(value);
    }
    candidates.push("mise".to_string());
    if let Some(home) = &home {
        candidates.push(format!("{home}/.local/bin/mise"));
        candidates.push(format!("{home}/.mise/bin/mise"));
    }
    candidates.push("/usr/local/bin/mise".to_string());
    candidates.push("/opt/homebrew/bin/mise".to_string());
    candidates.push("/usr/bin/mise".to_string());
    for candidate in &candidates {
        if matches!(Command::new(candidate).arg("--version").output(), Ok(out) if out.status.success())
        {
            return candidate.clone();
        }
    }
    "mise".to_string()
}

fn run_mise_use_global(_tool: &str, target: &str) -> std::io::Result<std::process::Output> {
    Command::new(resolve_mise_command())
        .args(["use", "-g", target])
        .output()
}

/// Run `mise <args>` (args already include the `exec -- ...` prefix where needed).
fn run_mise_exec(args: &[String]) -> std::io::Result<std::process::Output> {
    Command::new(resolve_mise_command()).args(args).output()
}

fn package_install_command(
    manager: &str,
    package_name: &str,
    version_spec: Option<&str>,
) -> Option<PackageCommand> {
    let spec = match version_spec
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(version) => format!("{package_name}@{version}"),
        None => package_name.to_string(),
    };
    let args: Vec<&str> = match manager {
        "uv" => vec!["exec", "--", "uv", "tool", "install", &spec],
        "pip" => vec!["exec", "--", "python3", "-m", "pip", "install", &spec],
        "bun" => vec!["exec", "--", "bun", "add", "-g", &spec],
        "go-install" => vec!["exec", "--", "go", "install", &spec],
        "cargo" => vec!["exec", "--", "cargo", "install", package_name],
        "gem" => vec!["exec", "--", "gem", "install", &spec],
        "composer" => vec!["exec", "--", "composer", "global", "require", &spec],
        "pnpm" => vec!["exec", "--", "pnpm", "add", "-g", &spec],
        "npm" => vec!["exec", "--", "npm", "install", "-g", &spec],
        _ => return None,
    };
    let args: Vec<String> = args.into_iter().map(ToString::to_string).collect();
    let text = format!("mise {}", args.join(" "));
    Some(PackageCommand { args, text })
}

fn package_uninstall_command(manager: &str, package_name: &str) -> Option<PackageCommand> {
    let args: Vec<&str> = match manager {
        "uv" => vec!["exec", "--", "uv", "tool", "uninstall", package_name],
        "pip" => vec![
            "exec",
            "--",
            "python3",
            "-m",
            "pip",
            "uninstall",
            "-y",
            package_name,
        ],
        "bun" => vec!["exec", "--", "bun", "remove", "-g", package_name],
        "cargo" => vec!["exec", "--", "cargo", "uninstall", package_name],
        "gem" => vec![
            "exec",
            "--",
            "gem",
            "uninstall",
            package_name,
            "-a",
            "-x",
            "-I",
        ],
        "composer" => vec!["exec", "--", "composer", "global", "remove", package_name],
        "pnpm" => vec!["exec", "--", "pnpm", "remove", "-g", package_name],
        "npm" => vec!["exec", "--", "npm", "uninstall", "-g", package_name],
        _ => return None,
    };
    let args: Vec<String> = args.into_iter().map(ToString::to_string).collect();
    let text = format!("mise {}", args.join(" "));
    Some(PackageCommand { args, text })
}

/// Mirrors listEnvironmentPackageManagers, keyed by tool ecosystem. Detected version is resolved
/// per-manager via the package handler's `version()` resolver so the UI reflects the resolved
/// executable version when available.
fn list_package_managers(tool: &str) -> Vec<EnvironmentPackageManagerOption> {
    package_runtime_managers(tool)
        .iter()
        .map(|manager| EnvironmentPackageManagerOption {
            id: manager.manager_id.to_string(),
            label: manager.label.to_string(),
            install_command_example: manager.install_example.to_string(),
            uninstall_command_example: manager.uninstall_example.to_string(),
            supported: true,
            detected_version: manager.version(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Package manager detection registry (mirrors environmentPackageRuntimes in packages.ts)
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct ResolvedInvocation {
    command: String,
    args: Vec<String>,
}

/// Run `{command} {args}` and return trimmed non-empty stdout lines on success, else empty.
fn run_lines(command: &str, args: &[String]) -> Vec<String> {
    let output = match Command::new(command).args(args).output() {
        Ok(out) => out,
        Err(_) => return Vec::new(),
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

/// Run a command and return combined stdout+stderr trimmed, with success flag.
fn run_combined(command: &str, args: &[String]) -> (bool, String) {
    match Command::new(command).args(args).output() {
        Ok(out) => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            (out.status.success(), combined.trim().to_string())
        }
        Err(_) => (false, String::new()),
    }
}

/// Mirrors firstSuccessfulCommand: candidates are (command, args_prefix, text_prefix); returns the
/// first whose `{command} {args_prefix} {probe_args}` exits 0.
fn first_successful_command(
    candidates: &[(String, Vec<String>, String)],
    probe_args: &[&str],
) -> Option<ResolvedCommandOwned> {
    for (command, args_prefix, text_prefix) in candidates {
        let mut args: Vec<String> = args_prefix.clone();
        args.extend(probe_args.iter().map(|value| value.to_string()));
        if matches!(Command::new(command).args(&args).output(), Ok(out) if out.status.success()) {
            return Some(ResolvedCommandOwned {
                command: command.clone(),
                args_prefix: args_prefix.clone(),
                text_prefix: text_prefix.clone(),
            });
        }
    }
    None
}

#[derive(Clone)]
struct ResolvedCommandOwned {
    command: String,
    args_prefix: Vec<String>,
    text_prefix: String,
}

fn resolve_pip_command() -> Option<ResolvedCommandOwned> {
    let mise = resolve_mise_command();
    let candidates = vec![
        (
            "python3".to_string(),
            vec!["-m".to_string(), "pip".to_string()],
            "python3 -m pip".to_string(),
        ),
        (
            "python".to_string(),
            vec!["-m".to_string(), "pip".to_string()],
            "python -m pip".to_string(),
        ),
        (
            mise,
            vec![
                "exec".to_string(),
                "--".to_string(),
                "python3".to_string(),
                "-m".to_string(),
                "pip".to_string(),
            ],
            "mise exec -- python3 -m pip".to_string(),
        ),
    ];
    first_successful_command(&candidates, &["--version"])
}

fn resolve_tool_command(command: &str) -> Option<ResolvedCommandOwned> {
    let mise = resolve_mise_command();
    let candidates = vec![
        (command.to_string(), Vec::new(), command.to_string()),
        (
            mise,
            vec!["exec".to_string(), "--".to_string(), command.to_string()],
            format!("mise exec -- {command}"),
        ),
    ];
    first_successful_command(&candidates, &["--version"])
}

/// Mirrors resolveCommandInvocation: when command is `mise exec -- <tool> ...`, resolve <tool>
/// directly (PATH or via mise); otherwise resolve the mise binary when command == "mise".
fn resolve_command_invocation(command: &str, args: &[String]) -> ResolvedInvocation {
    if command == "mise"
        && args.first().map(String::as_str) == Some("exec")
        && args.get(1).map(String::as_str) == Some("--")
    {
        if let Some(tool) = args.get(2) {
            if let Some(resolved) = resolve_tool_command(tool) {
                let mut final_args = resolved.args_prefix.clone();
                final_args.extend(args.iter().skip(3).cloned());
                return ResolvedInvocation {
                    command: resolved.command,
                    args: final_args,
                };
            }
        }
    }
    let resolved_command = if command == "mise" {
        resolve_mise_command()
    } else {
        command.to_string()
    };
    ResolvedInvocation {
        command: resolved_command,
        args: args.to_vec(),
    }
}

/// Mirrors installedPackageLines: resolve invocation, run, return trimmed non-empty stdout lines.
fn installed_package_lines(command: &str, args: &[&str]) -> Vec<String> {
    let owned: Vec<String> = args.iter().map(|value| value.to_string()).collect();
    let resolved = resolve_command_invocation(command, &owned);
    run_lines(&resolved.command, &resolved.args)
}

/// Mirrors commandVersion but resolves the tool through PATH or mise so detection works when the
/// binary is only available via mise shims.
fn command_version(command: &str, args: &[&str]) -> Option<String> {
    let resolved = resolve_tool_command(command)?;
    let mut final_args = resolved.args_prefix.clone();
    final_args.extend(args.iter().map(|value| value.to_string()));
    let (ok, combined) = run_combined(&resolved.command, &final_args);
    if !ok {
        return None;
    }
    let first = combined.lines().next().map(str::trim).unwrap_or("");
    Some(if first.is_empty() {
        "installed".to_string()
    } else {
        first.to_string()
    })
}

fn parse_json_value_from_output(
    output: &str,
    open: char,
    close: char,
) -> Option<serde_json::Value> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Fast path: the whole output is valid JSON.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let matches = match open {
            '[' => value.is_array(),
            '{' => value.is_object(),
            _ => false,
        };
        if matches {
            return Some(value);
        }
    }
    let chars: Vec<char> = trimmed.chars().collect();
    let mut search_from = 0usize;
    while let Some(rel) = chars[search_from..].iter().position(|&ch| ch == open) {
        let start = search_from + rel;
        let mut depth = 0i32;
        let mut in_string = false;
        let mut escaped = false;
        for index in start..chars.len() {
            let ch = chars[index];
            if in_string {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    in_string = false;
                }
                continue;
            }
            if ch == '"' {
                in_string = true;
                continue;
            }
            if ch == open {
                depth += 1;
            }
            if ch == close {
                depth -= 1;
            }
            if depth == 0 {
                let slice: String = chars[start..=index].iter().collect();
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&slice) {
                    return Some(value);
                }
                break;
            }
        }
        search_from = start + 1;
    }
    None
}

fn parse_json_array_from_output(output: &str) -> Vec<serde_json::Value> {
    match parse_json_value_from_output(output, '[', ']') {
        Some(serde_json::Value::Array(items)) => items,
        _ => Vec::new(),
    }
}

fn parse_json_object_from_output(
    output: &str,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    match parse_json_value_from_output(output, '{', '}') {
        Some(serde_json::Value::Object(map)) => Some(map),
        _ => None,
    }
}

fn detected_package_install_command_text(
    manager: &str,
    package_name: &str,
    version_spec: Option<&str>,
) -> String {
    let trimmed = version_spec
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let spec = match trimmed {
        Some(version) => format!("{package_name}@{version}"),
        None => package_name.to_string(),
    };
    match manager {
        "pip" => format!("python3 -m pip install {spec}"),
        "uv" => format!("uv tool install {spec}"),
        "pnpm" => format!("pnpm add -g {spec}"),
        "npm" => format!("npm install -g {spec}"),
        "bun" => format!("bun add -g {spec}"),
        "go-install" => {
            if trimmed.is_some() {
                format!("go install {spec}")
            } else {
                format!("go install {package_name}@latest")
            }
        }
        "cargo" => format!("cargo install {package_name}"),
        "gem" => format!("gem install {spec}"),
        "composer" => format!("composer global require {spec}"),
        _ => match package_install_command(manager, package_name, version_spec) {
            Some(cmd) => format!("mise {}", cmd.args.join(" ")),
            None => format!("mise exec -- {manager} install {package_name}"),
        },
    }
}

fn detected_package_uninstall_command_text(manager: &str, package_name: &str) -> Option<String> {
    match manager {
        "pip" => Some(format!("python3 -m pip uninstall -y {package_name}")),
        "uv" => Some(format!("uv tool uninstall {package_name}")),
        "pnpm" => Some(format!("pnpm remove -g {package_name}")),
        "npm" => Some(format!("npm uninstall -g {package_name}")),
        "bun" => Some(format!("bun remove -g {package_name}")),
        "cargo" => Some(format!("cargo uninstall {package_name}")),
        "gem" => Some(format!("gem uninstall {package_name} -a -x -I")),
        "composer" => Some(format!("composer global remove {package_name}")),
        "go-install" => Some(format!("Remove {package_name} from GOPATH/bin manually")),
        "shards" => Some("Manual cleanup required".to_string()),
        _ => package_uninstall_command(manager, package_name)
            .map(|cmd| format!("mise {}", cmd.args.join(" "))),
    }
}

#[allow(clippy::too_many_arguments)]
fn detected_environment_package_record(
    tool_record: &EnvironmentToolRecord,
    manager: &str,
    package_name: &str,
    installed_version: Option<String>,
    version_spec: Option<String>,
    command_package_name: &str,
    install_command_override: Option<String>,
    uninstall_command_override: Option<String>,
) -> EnvironmentPackageRecord {
    let now = timestamp();
    EnvironmentPackageRecord {
        id: format!("detected-{}-{}-{}", tool_record.id, manager, package_name),
        tool_record_id: Some(tool_record.id.clone()),
        tool: tool_record.tool.clone(),
        runtime_version: Some(tool_record.requested_version.clone()),
        ecosystem: tool_record.tool.to_lowercase(),
        manager: manager.to_string(),
        package_name: package_name.to_string(),
        version_spec,
        installed_version,
        install_command: install_command_override.unwrap_or_else(|| {
            detected_package_install_command_text(manager, command_package_name, None)
        }),
        uninstall_command: uninstall_command_override
            .or_else(|| detected_package_uninstall_command_text(manager, package_name)),
        target_label: format!("{}@{}", tool_record.tool, tool_record.requested_version),
        scope: "global".to_string(),
        auto_restore: true,
        persisted: false,
        status: Some("installed".to_string()),
        notes: None,
        created_at: now.clone(),
        updated_at: Some(now),
    }
}

type InspectFn = fn(&str) -> (bool, Option<String>);
type ScanFn = fn(&EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord>;

struct PackageHandler {
    manager_id: &'static str,
    label: &'static str,
    install_example: &'static str,
    uninstall_example: &'static str,
    version_command: &'static str,
    version_args: &'static [&'static str],
    inspect: Option<InspectFn>,
    scan: Option<ScanFn>,
}

impl PackageHandler {
    fn version(&self) -> Option<String> {
        command_version(self.version_command, self.version_args)
    }
}

// --- inspect helpers -------------------------------------------------------

fn inspect_pip(pkg: &str) -> (bool, Option<String>) {
    let Some(resolved) = resolve_pip_command() else {
        return (false, None);
    };
    let mut args = resolved.args_prefix.clone();
    args.push("show".to_string());
    args.push(pkg.to_string());
    let (ok, combined) = run_combined(&resolved.command, &args);
    if !ok {
        return (false, None);
    }
    let version = combined
        .lines()
        .find(|line| line.starts_with("Version:"))
        .map(|line| line.trim_start_matches("Version:").trim().to_string());
    (version.is_some(), version)
}

fn inspect_uv(pkg: &str) -> (bool, Option<String>) {
    let lower = pkg.to_lowercase();
    let prefix = format!("{lower} ");
    for line in installed_package_lines("mise", &["exec", "--", "uv", "tool", "list"]) {
        if line.to_lowercase().starts_with(&prefix) {
            let version = line.split_whitespace().nth(1).map(ToString::to_string);
            return (true, version);
        }
    }
    (false, None)
}

fn inspect_pnpm(pkg: &str) -> (bool, Option<String>) {
    let Some(resolved) = resolve_tool_command("pnpm") else {
        return (false, None);
    };
    let mut args = resolved.args_prefix.clone();
    args.extend(
        ["list", "-g", pkg, "--depth", "0", "--json"]
            .iter()
            .map(ToString::to_string),
    );
    let (ok, combined) = run_combined(&resolved.command, &args);
    if !ok || combined.is_empty() {
        return (false, None);
    }
    let parsed = parse_json_array_from_output(&combined);
    let version = parsed
        .first()
        .and_then(|item| item.get("dependencies"))
        .and_then(|deps| deps.get(pkg))
        .and_then(|entry| entry.get("version"))
        .and_then(|value| value.as_str())
        .map(ToString::to_string);
    (version.is_some(), version)
}

fn inspect_npm(pkg: &str) -> (bool, Option<String>) {
    let Some(resolved) = resolve_tool_command("npm") else {
        return (false, None);
    };
    let mut args = resolved.args_prefix.clone();
    args.extend(
        ["list", "-g", pkg, "--depth", "0", "--json"]
            .iter()
            .map(ToString::to_string),
    );
    let (_ok, combined) = run_combined(&resolved.command, &args);
    if combined.is_empty() {
        return (false, None);
    }
    let version = parse_json_object_from_output(&combined)
        .and_then(|map| map.get("dependencies").cloned())
        .and_then(|deps| deps.get(pkg).cloned())
        .and_then(|entry| entry.get("version").cloned())
        .and_then(|value| value.as_str().map(ToString::to_string));
    (version.is_some(), version)
}

fn extract_cargo_version(line: &str) -> Option<String> {
    for token in line.split_whitespace() {
        if let Some(rest) = token.strip_prefix('v') {
            if rest
                .chars()
                .next()
                .map(|ch| ch.is_ascii_digit())
                .unwrap_or(false)
            {
                return Some(rest.to_string());
            }
        }
    }
    None
}

fn inspect_cargo(pkg: &str) -> (bool, Option<String>) {
    let prefix = format!("{} ", pkg.to_lowercase());
    for line in installed_package_lines("mise", &["exec", "--", "cargo", "install", "--list"]) {
        if line.to_lowercase().starts_with(&prefix) {
            return (true, extract_cargo_version(&line));
        }
    }
    (false, None)
}

fn extract_paren_version(line: &str) -> Option<String> {
    let start = line.find('(')?;
    let end = line[start + 1..].find(')')? + start + 1;
    let inner = &line[start + 1..end];
    inner
        .split(',')
        .next()
        .map(|value| value.trim().to_string())
}

fn inspect_bun(pkg: &str) -> (bool, Option<String>) {
    let prefix = format!("{}@", pkg.to_lowercase());
    for line in installed_package_lines("mise", &["exec", "--", "bun", "pm", "ls", "-g"]) {
        if line.to_lowercase().starts_with(&prefix) {
            let version = line.splitn(2, '@').nth(1).map(ToString::to_string);
            return (true, version);
        }
    }
    (false, None)
}

fn inspect_gem(pkg: &str) -> (bool, Option<String>) {
    let lower = pkg.to_lowercase();
    for line in installed_package_lines("mise", &["exec", "--", "gem", "list", pkg]) {
        if line.to_lowercase().starts_with(&lower) {
            return (true, extract_paren_version(&line));
        }
    }
    (false, None)
}

fn inspect_composer(pkg: &str) -> (bool, Option<String>) {
    let lower = pkg.to_lowercase();
    for line in installed_package_lines("mise", &["exec", "--", "composer", "global", "show", pkg])
    {
        if line.to_lowercase().starts_with(&lower) {
            let version = line.split_whitespace().nth(1).map(ToString::to_string);
            return (true, version);
        }
    }
    (false, None)
}

fn inspect_dotnet(pkg: &str) -> (bool, Option<String>) {
    let lower = pkg.to_lowercase();
    for line in installed_package_lines("mise", &["exec", "--", "dotnet", "tool", "list", "-g"]) {
        if line.to_lowercase().starts_with(&lower) {
            let version = line.split_whitespace().nth(1).map(ToString::to_string);
            return (true, version);
        }
    }
    (false, None)
}

fn inspect_deno(_pkg: &str) -> (bool, Option<String>) {
    let Some(resolved) = resolve_tool_command("deno") else {
        return (false, None);
    };
    let mut args = resolved.args_prefix.clone();
    args.extend(["uninstall", "--help"].iter().map(ToString::to_string));
    let installed = matches!(Command::new(&resolved.command).args(&args).output(), Ok(out) if out.status.success());
    (installed, None)
}

fn inspect_line_contains(pkg: &str, args: &[&str]) -> (bool, Option<String>) {
    let lower = pkg.to_lowercase();
    let installed = installed_package_lines("mise", args)
        .iter()
        .any(|line| line.to_lowercase().contains(&lower));
    (installed, None)
}

fn inspect_line_starts(pkg: &str, args: &[&str]) -> (bool, Option<String>) {
    let lower = pkg.to_lowercase();
    let installed = installed_package_lines("mise", args)
        .iter()
        .any(|line| line.to_lowercase().starts_with(&lower));
    (installed, None)
}

fn inspect_mix(pkg: &str) -> (bool, Option<String>) {
    inspect_line_contains(pkg, &["exec", "--", "mix", "archive"])
}

fn inspect_nimble(pkg: &str) -> (bool, Option<String>) {
    inspect_line_starts(pkg, &["exec", "--", "nimble", "list", "-i"])
}

fn inspect_dart(pkg: &str) -> (bool, Option<String>) {
    inspect_line_starts(pkg, &["exec", "--", "dart", "pub", "global", "list"])
}

fn inspect_luarocks(pkg: &str) -> (bool, Option<String>) {
    inspect_line_starts(pkg, &["exec", "--", "luarocks", "list"])
}

// --- scan helpers ----------------------------------------------------------

fn scan_pip(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    let Some(resolved) = resolve_pip_command() else {
        return Vec::new();
    };
    let mut args = resolved.args_prefix.clone();
    args.extend(["list", "--format", "json"].iter().map(ToString::to_string));
    let (ok, combined) = run_combined(&resolved.command, &args);
    if !ok || combined.is_empty() {
        return Vec::new();
    }
    parse_json_array_from_output(&combined)
        .into_iter()
        .filter_map(|item| {
            let name = item
                .get("name")
                .and_then(|value| value.as_str())?
                .to_string();
            let version = item
                .get("version")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            Some(detected_environment_package_record(
                tool_record,
                "pip",
                &name,
                version.clone(),
                version,
                &name,
                Some(format!("{} install {name}", resolved.text_prefix)),
                Some(format!("{} uninstall -y {name}", resolved.text_prefix)),
            ))
        })
        .collect()
}

fn scan_pnpm(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    let Some(resolved) = resolve_tool_command("pnpm") else {
        return Vec::new();
    };
    let mut args = resolved.args_prefix.clone();
    args.extend(
        ["list", "-g", "--depth", "0", "--json"]
            .iter()
            .map(ToString::to_string),
    );
    let (ok, combined) = run_combined(&resolved.command, &args);
    if !ok || combined.is_empty() {
        return Vec::new();
    }
    let parsed = parse_json_array_from_output(&combined);
    let deps = parsed
        .first()
        .and_then(|item| item.get("dependencies"))
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    deps.into_iter()
        .map(|(name, value)| {
            let version = value
                .get("version")
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            detected_environment_package_record(
                tool_record,
                "pnpm",
                &name,
                version.clone(),
                version,
                &name,
                None,
                None,
            )
        })
        .collect()
}

fn scan_npm(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    let Some(resolved) = resolve_tool_command("npm") else {
        return Vec::new();
    };
    let mut args = resolved.args_prefix.clone();
    args.extend(
        ["list", "-g", "--depth", "0", "--json"]
            .iter()
            .map(ToString::to_string),
    );
    let (_ok, combined) = run_combined(&resolved.command, &args);
    if combined.is_empty() {
        return Vec::new();
    }
    let deps = parse_json_object_from_output(&combined)
        .and_then(|map| map.get("dependencies").cloned())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    deps.into_iter()
        .map(|(name, value)| {
            let version = value
                .get("version")
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            detected_environment_package_record(
                tool_record,
                "npm",
                &name,
                version.clone(),
                version,
                &name,
                None,
                None,
            )
        })
        .collect()
}

fn scan_cargo(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    installed_package_lines("mise", &["exec", "--", "cargo", "install", "--list"])
        .into_iter()
        .filter_map(|line| {
            if !line.contains(" v") {
                return None;
            }
            let name = line.split_whitespace().next()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let version = extract_cargo_version(&line);
            Some(detected_environment_package_record(
                tool_record,
                "cargo",
                &name,
                version.clone(),
                version,
                &name,
                None,
                None,
            ))
        })
        .collect()
}

fn scan_gem(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    installed_package_lines("mise", &["exec", "--", "gem", "list", "--local"])
        .into_iter()
        .filter_map(|line| {
            if line.starts_with("***") {
                return None;
            }
            let name = line.split_whitespace().next()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let version = extract_paren_version(&line);
            Some(detected_environment_package_record(
                tool_record,
                "gem",
                &name,
                version.clone(),
                version,
                &name,
                None,
                None,
            ))
        })
        .collect()
}

fn scan_bun(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    installed_package_lines("mise", &["exec", "--", "bun", "pm", "ls", "-g"])
        .into_iter()
        .filter_map(|line| {
            if !line.contains('@') {
                return None;
            }
            let at = line.rfind('@')?;
            let name = line[..at].to_string();
            let version = Some(line[at + 1..].to_string());
            Some(detected_environment_package_record(
                tool_record,
                "bun",
                &name,
                version.clone(),
                version,
                &name,
                None,
                None,
            ))
        })
        .collect()
}

fn scan_composer(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    installed_package_lines(
        "mise",
        &["exec", "--", "composer", "global", "show", "--name-only"],
    )
    .into_iter()
    .filter_map(|line| {
        if line.is_empty() {
            return None;
        }
        Some(detected_environment_package_record(
            tool_record,
            "composer",
            &line,
            None,
            None,
            &line,
            None,
            None,
        ))
    })
    .collect()
}

fn scan_dotnet(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    installed_package_lines("mise", &["exec", "--", "dotnet", "tool", "list", "-g"])
        .into_iter()
        .skip(2)
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let name = fields.next()?.to_string();
            if name.is_empty() {
                return None;
            }
            let version = fields.next().map(ToString::to_string);
            Some(detected_environment_package_record(
                tool_record,
                "dotnet-tool",
                &name,
                version.clone(),
                version,
                &name,
                None,
                None,
            ))
        })
        .collect()
}

fn scan_nimble(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    installed_package_lines("mise", &["exec", "--", "nimble", "list", "-i"])
        .into_iter()
        .filter_map(|line| {
            if !line.contains('[') {
                return None;
            }
            let name = line.split_whitespace().next()?.to_string();
            if name.is_empty() {
                return None;
            }
            Some(detected_environment_package_record(
                tool_record,
                "nimble",
                &name,
                None,
                None,
                &name,
                None,
                None,
            ))
        })
        .collect()
}

fn scan_dart(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    installed_package_lines("mise", &["exec", "--", "dart", "pub", "global", "list"])
        .into_iter()
        .filter_map(|line| {
            let name = line.split_whitespace().next()?.to_string();
            if name.is_empty() {
                return None;
            }
            Some(detected_environment_package_record(
                tool_record,
                "dart-pub",
                &name,
                None,
                None,
                &name,
                None,
                None,
            ))
        })
        .collect()
}

fn scan_luarocks(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    installed_package_lines("mise", &["exec", "--", "luarocks", "list"])
        .into_iter()
        .filter_map(|line| {
            if line.starts_with("Rocks") || line.starts_with("--") {
                return None;
            }
            let name = line.split_whitespace().next()?.to_string();
            if name.is_empty() {
                return None;
            }
            Some(detected_environment_package_record(
                tool_record,
                "luarocks",
                &name,
                None,
                None,
                &name,
                None,
                None,
            ))
        })
        .collect()
}

/// Mirrors environmentPackageRuntimes: per-tool manager registry.
fn package_runtime_managers(tool: &str) -> Vec<PackageHandler> {
    let key = tool.trim().to_lowercase();
    match key.as_str() {
        "python" => vec![
            PackageHandler {
                manager_id: "pip",
                label: "pip",
                install_example: "python3 -m pip install <package>",
                uninstall_example: "python3 -m pip uninstall <package>",
                version_command: "python3",
                version_args: &["--version"],
                inspect: Some(inspect_pip),
                scan: Some(scan_pip),
            },
            PackageHandler {
                manager_id: "uv",
                label: "uv tool",
                install_example: "uv tool install <package>",
                uninstall_example: "uv tool uninstall <package>",
                version_command: "uv",
                version_args: &["--version"],
                inspect: Some(inspect_uv),
                scan: None,
            },
        ],
        "node" => vec![
            PackageHandler {
                manager_id: "pnpm",
                label: "pnpm",
                install_example: "pnpm add -g <package>",
                uninstall_example: "pnpm remove -g <package>",
                version_command: "pnpm",
                version_args: &["--version"],
                inspect: Some(inspect_pnpm),
                scan: Some(scan_pnpm),
            },
            PackageHandler {
                manager_id: "npm",
                label: "npm",
                install_example: "npm install -g <package>",
                uninstall_example: "npm uninstall -g <package>",
                version_command: "npm",
                version_args: &["--version"],
                inspect: Some(inspect_npm),
                scan: Some(scan_npm),
            },
        ],
        "bun" => vec![PackageHandler {
            manager_id: "bun",
            label: "bun",
            install_example: "bun add -g <package>",
            uninstall_example: "bun remove -g <package>",
            version_command: "bun",
            version_args: &["--version"],
            inspect: Some(inspect_bun),
            scan: Some(scan_bun),
        }],
        "go" => vec![PackageHandler {
            manager_id: "go-install",
            label: "go install",
            install_example: "go install <package>@latest",
            uninstall_example: "rm <go-bin>/<package>",
            version_command: "go",
            version_args: &["version"],
            inspect: None,
            scan: None,
        }],
        "rust" => vec![PackageHandler {
            manager_id: "cargo",
            label: "cargo",
            install_example: "cargo install <package>",
            uninstall_example: "cargo uninstall <package>",
            version_command: "cargo",
            version_args: &["--version"],
            inspect: Some(inspect_cargo),
            scan: Some(scan_cargo),
        }],
        "ruby" => vec![PackageHandler {
            manager_id: "gem",
            label: "gem",
            install_example: "gem install <package>",
            uninstall_example: "gem uninstall <package>",
            version_command: "gem",
            version_args: &["--version"],
            inspect: Some(inspect_gem),
            scan: Some(scan_gem),
        }],
        "php" => vec![PackageHandler {
            manager_id: "composer",
            label: "composer",
            install_example: "composer global require <package>",
            uninstall_example: "composer global remove <package>",
            version_command: "composer",
            version_args: &["--version"],
            inspect: Some(inspect_composer),
            scan: Some(scan_composer),
        }],
        "deno" => vec![PackageHandler {
            manager_id: "deno",
            label: "deno",
            install_example: "deno install --global -A <package>",
            uninstall_example: "deno uninstall <package>",
            version_command: "deno",
            version_args: &["--version"],
            inspect: Some(inspect_deno),
            scan: None,
        }],
        "dotnet" => vec![PackageHandler {
            manager_id: "dotnet-tool",
            label: "dotnet tool",
            install_example: "dotnet tool install -g <package>",
            uninstall_example: "dotnet tool uninstall -g <package>",
            version_command: "dotnet",
            version_args: &["--version"],
            inspect: Some(inspect_dotnet),
            scan: Some(scan_dotnet),
        }],
        "elixir" | "erlang" => vec![PackageHandler {
            manager_id: "mix-archive",
            label: "mix archive",
            install_example: "mix archive.install hex <package> --force",
            uninstall_example: "mix archive.uninstall <package>",
            version_command: "mix",
            version_args: &["--version"],
            inspect: Some(inspect_mix),
            scan: None,
        }],
        "nim" => vec![PackageHandler {
            manager_id: "nimble",
            label: "nimble",
            install_example: "nimble install -y <package>",
            uninstall_example: "nimble uninstall -y <package>",
            version_command: "nimble",
            version_args: &["--version"],
            inspect: Some(inspect_nimble),
            scan: Some(scan_nimble),
        }],
        "dart" | "flutter" => vec![PackageHandler {
            manager_id: "dart-pub",
            label: "dart pub",
            install_example: "dart pub global activate <package>",
            uninstall_example: "dart pub global deactivate <package>",
            version_command: "dart",
            version_args: &["--version"],
            inspect: Some(inspect_dart),
            scan: Some(scan_dart),
        }],
        "lua" => vec![PackageHandler {
            manager_id: "luarocks",
            label: "luarocks",
            install_example: "luarocks install <package>",
            uninstall_example: "luarocks remove <package>",
            version_command: "luarocks",
            version_args: &["--version"],
            inspect: Some(inspect_luarocks),
            scan: Some(scan_luarocks),
        }],
        "perl" => vec![PackageHandler {
            manager_id: "cpanm",
            label: "cpanm",
            install_example: "cpanm <package>",
            uninstall_example: "cpanm --uninstall <package>",
            version_command: "cpanm",
            version_args: &["--version"],
            inspect: None,
            scan: None,
        }],
        "crystal" => vec![PackageHandler {
            manager_id: "shards",
            label: "shards",
            install_example: "shards install <package>",
            uninstall_example: "rm -rf <shard>",
            version_command: "shards",
            version_args: &["--version"],
            inspect: None,
            scan: None,
        }],
        _ => Vec::new(),
    }
}

fn package_handler_for_manager(manager: &str) -> Option<PackageHandler> {
    for tool in [
        "python", "node", "bun", "go", "rust", "ruby", "php", "deno", "dotnet", "elixir", "nim",
        "dart", "lua", "perl", "crystal",
    ] {
        if let Some(handler) = package_runtime_managers(tool)
            .into_iter()
            .find(|item| item.manager_id == manager)
        {
            return Some(handler);
        }
    }
    None
}

/// Mirrors scanEnvironmentPackages: run every manager scan for the tool and concatenate.
fn scan_environment_packages(tool_record: &EnvironmentToolRecord) -> Vec<EnvironmentPackageRecord> {
    package_runtime_managers(&tool_record.tool)
        .into_iter()
        .filter_map(|manager| manager.scan)
        .flat_map(|scan| scan(tool_record))
        .collect()
}

/// Mirrors inspectEnvironmentPackage: probe via the manager's inspect handler.
fn inspect_environment_package(manager: &str, package_name: &str) -> (bool, Option<String>) {
    match package_handler_for_manager(manager).and_then(|handler| handler.inspect) {
        Some(inspect) => inspect(package_name),
        None => (false, None),
    }
}

fn push_restore_run(overview: &mut EnvironmentOverview, status: &str, summary: String) {
    overview.restore_runs.insert(
        0,
        EnvironmentRestoreRun {
            id: format!("env-restore-{}", random_hex(16)),
            status: status.to_string(),
            summary,
            created_at: timestamp(),
        },
    );
    overview.restore_runs.truncate(20);
}

fn command_output_detail(result: &std::io::Result<std::process::Output>) -> Option<String> {
    let out = result.as_ref().ok()?;
    let detail = (String::from_utf8_lossy(&out.stderr).to_string()
        + &String::from_utf8_lossy(&out.stdout))
        .trim()
        .to_string();
    if detail.is_empty() {
        None
    } else {
        Some(detail)
    }
}

fn command_failure_detail(
    install: &std::io::Result<std::process::Output>,
    verify: &std::io::Result<std::process::Output>,
) -> Option<String> {
    let mut parts = Vec::new();
    if let Ok(out) = install {
        parts.push(String::from_utf8_lossy(&out.stderr).to_string());
        parts.push(String::from_utf8_lossy(&out.stdout).to_string());
    }
    if let Ok(out) = verify {
        parts.push(String::from_utf8_lossy(&out.stderr).to_string());
        parts.push(String::from_utf8_lossy(&out.stdout).to_string());
    }
    let detail = parts.join("\n").trim().to_string();
    if detail.is_empty() {
        None
    } else {
        Some(detail)
    }
}

fn compare_semver_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |value: &str| -> Vec<i64> {
        value
            .split('.')
            .map(|part| {
                let digits: String = part.chars().take_while(|ch| ch.is_ascii_digit()).collect();
                digits.parse::<i64>().unwrap_or(0)
            })
            .collect()
    };
    let left = parse(a);
    let right = parse(b);
    let length = left.len().max(right.len());
    for index in 0..length {
        let diff = right.get(index).copied().unwrap_or(0) - left.get(index).copied().unwrap_or(0);
        if diff != 0 {
            return diff.cmp(&0);
        }
    }
    b.cmp(a)
}

fn recommend_versions(
    tool: &str,
    items: &[EnvironmentToolVersionItem],
) -> Vec<EnvironmentToolVersionItem> {
    if items.is_empty() {
        return Vec::new();
    }
    let normalized = tool.trim().to_lowercase();
    if matches!(normalized.as_str(), "node" | "python" | "bun") {
        let mut latest_by_major: Vec<(i64, &EnvironmentToolVersionItem)> = Vec::new();
        for item in items {
            let major = item
                .version
                .split('.')
                .next()
                .and_then(|part| part.parse::<i64>().ok());
            let Some(major) = major else { continue };
            if !latest_by_major
                .iter()
                .any(|(existing, _)| *existing == major)
            {
                latest_by_major.push((major, item));
            }
        }
        latest_by_major.sort_by(|a, b| b.0.cmp(&a.0));
        return latest_by_major
            .into_iter()
            .take(6)
            .enumerate()
            .map(|(index, (_, item))| EnvironmentToolVersionItem {
                version: item.version.clone(),
                recommended: Some(index < 3),
            })
            .collect();
    }
    items
        .iter()
        .take(12)
        .enumerate()
        .map(|(index, item)| EnvironmentToolVersionItem {
            version: item.version.clone(),
            recommended: Some(index < 6),
        })
        .collect()
}
