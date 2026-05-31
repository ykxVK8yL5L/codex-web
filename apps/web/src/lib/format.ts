import type { ArchiveIgnoreTemplate } from "@codex-web/protocol";

export function formatShortDate(value?: string) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function renderPreviewCommand(template: string, port: string, directory: string) {
  const safePort = port.trim();
  const safeDirectory = directory.trim() || ".";
  return template
    .replaceAll("{port}", safePort)
    .replaceAll("{dir}", shellQuote(safeDirectory));
}

export function rulesForArchiveTemplates(templates: ArchiveIgnoreTemplate[], templateIds: string[]) {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const template of templates) {
    if (!templateIds.includes(template.id)) continue;
    for (const rule of template.rules.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      if (seen.has(rule)) continue;
      seen.add(rule);
      rules.push(rule);
    }
  }
  return rules.join("\n");
}
