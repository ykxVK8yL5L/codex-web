use std::path::{Path, PathBuf};

use anyhow::{bail, Context};

pub fn normalize_path(value: &Path) -> anyhow::Result<PathBuf> {
    value
        .canonicalize()
        .with_context(|| format!("failed to resolve path {}", value.display()))
}

pub fn resolve_inside_root(root: &Path, input: Option<&str>) -> anyhow::Result<PathBuf> {
    let root = normalize_path(root)?;
    let requested = input
        .filter(|item| !item.is_empty() && *item != ".")
        .unwrap_or(".");
    let absolute = normalize_path(&root.join(requested))?;
    if absolute != root && !absolute.starts_with(&root) {
        bail!("path_outside_root");
    }
    Ok(absolute)
}

pub fn resolve_child_path(root: &Path, target: &Path) -> anyhow::Result<PathBuf> {
    let root = normalize_path(root)?;
    let parent = target.parent().unwrap_or(&root);
    let parent = normalize_path(parent)?;
    if parent != root && !parent.starts_with(&root) {
        bail!("path_outside_root");
    }
    Ok(parent.join(
        target
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("invalid_name"))?,
    ))
}

pub fn relative_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .filter(|item| !item.as_os_str().is_empty())
        .map(|item| {
            item.components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_else(|| ".".to_string())
}
