import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AgentRoleTemplateSummary } from "@codex-web/protocol";

export type AgentRoleTemplateRecord = AgentRoleTemplateSummary & { markdownContent: string };

export function markdownTitle(value: string) {
  return value.split(/\r?\n/).find((line) => line.trim().startsWith("# "))?.replace(/^#\s+/, "").trim() ?? "";
}

export function markdownDescription(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstBodyLine = lines.find((line) => !line.startsWith("#"));
  return firstBodyLine ? firstBodyLine.slice(0, 240) : "";
}

export function systemPromptWithRoleDescription(systemPrompt: string, description?: string | null, enabled = false) {
  const cleanDescription = description?.trim();
  if (!enabled || !cleanDescription) return systemPrompt;
  const heading = "## Role Extension Description";
  if (systemPrompt.includes(heading)) return systemPrompt;
  return `${systemPrompt.trim()}\n\n${heading}\n${cleanDescription}`;
}

export function parseMarkdownFrontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields: Record<string, string> = {};
  if (!match) return fields;
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) fields[item[1]] = item[2].replace(/^["']|["']$/g, "").trim();
  }
  return fields;
}

function readJsonFileWithFallback<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function createAgentRoleTemplateService(agentRoleTemplateDir: string) {
  function listAgentRoleTemplates(): AgentRoleTemplateRecord[] {
    if (!existsSync(agentRoleTemplateDir)) return [];
    const zhNamesPath = join(agentRoleTemplateDir, "agency-agents", "scripts", "i18n", "agent-names-zh.json");
    const zhNames = existsSync(zhNamesPath) ? readJsonFileWithFallback<Record<string, { name?: string; description?: string }>>(zhNamesPath, {}) : {};
    const useLocalizedAllowlist = Object.keys(zhNames).length > 0;
    function walk(dir: string, groupParts: string[] = []): AgentRoleTemplateRecord[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const filePath = join(dir, entry.name);
        if (entry.isDirectory()) return walk(filePath, [...groupParts, entry.name]);
        if (!entry.isFile() || !/\.md$/i.test(entry.name)) return [];
        const markdownContent = readFileSync(filePath, "utf8");
        const metadata = parseMarkdownFrontmatter(markdownContent);
        if (!metadata.name) return [];
        const isAgencyTemplate = groupParts[0] === "agency-agents";
        if (useLocalizedAllowlist && isAgencyTemplate && !zhNames[metadata.name]) return [];
        const filename = entry.name.replace(/\.md$/i, "");
        const group = groupParts.join("/") || "Root";
        const id = [...groupParts, filename].join("-").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
        const localized = zhNames[metadata.name]
          ? {
              "zh-CN": { name: zhNames[metadata.name].name || metadata.name, description: zhNames[metadata.name].description },
              zh: { name: zhNames[metadata.name].name || metadata.name, description: zhNames[metadata.name].description },
            }
          : undefined;
        return [{
          id,
          name: metadata.name || markdownTitle(markdownContent) || filename.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
          group,
          description: metadata.description || markdownDescription(markdownContent),
          localizedNames: localized,
          sourcePath: relative(agentRoleTemplateDir, filePath),
          sourceUrl: isAgencyTemplate ? `https://github.com/msitarzewski/agency-agents/blob/main/${relative(join(agentRoleTemplateDir, "agency-agents"), filePath)}` : undefined,
          markdownContent,
        }];
      });
    }
    return walk(agentRoleTemplateDir)
      .sort((a, b) => a.group === b.group ? a.name.localeCompare(b.name) : a.group.localeCompare(b.group));
  }

  function publicAgentRoleTemplate(template: AgentRoleTemplateRecord): AgentRoleTemplateSummary {
    const { markdownContent, ...summary } = template;
    return summary;
  }

  return {
    listAgentRoleTemplates,
    publicAgentRoleTemplate,
  };
}
