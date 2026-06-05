import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type {
  CreateMcpServerRequest,
  CreatePluginRequest,
  CreateSkillRequest,
  DeleteSkillRequest,
  ExtensionDetail,
  ExtensionSummary,
  ImportMarketplaceCatalogRequest,
  ImportMcpServerRequest,
  ImportMcpServerResponse,
  ImportSkillRequest,
  ImportSkillResponse,
  InstallMarketplaceItemRequest,
  InstallMarketplaceItemResponse,
  MarketplaceCatalog,
  MarketplaceCatalogItem,
  MarketplaceCatalogResponse,
  UpdateSkillRequest,
} from "@codex-web/protocol";
import { decodePageCursor, pageFromRows } from "../pagination.js";

type ExtensionServiceDeps = {
  codexHome: string;
  loadJsonSetting: <T>(key: string, fallback: T) => T;
  saveJsonSetting: (key: string, value: unknown) => void;
  slugify: (value: string) => string;
};

export function createExtensionService(deps: ExtensionServiceDeps) {
  const { codexHome, loadJsonSetting, saveJsonSetting, slugify } = deps;

function readJsonFile(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type SkillMetadata = { name?: string; description?: string };

function readSkillMetadataFromContent(content: string): SkillMetadata {
  const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/m)?.[1] ?? "";
  const frontMatterName = frontMatter.match(/^name:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
  const frontMatterDescription = content.match(/^---[\s\S]*?\ndescription:\s*["']?([^"'\n]+)["']?/m)?.[1];
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const description = frontMatterDescription?.trim()
    ?? content.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("---") && !line.startsWith("#"))?.trim();
  return { name: frontMatterName ?? title, description };
}

function readSkillMetadata(path: string): SkillMetadata {
  try {
    const content = readFileSync(path, "utf8");
    return readSkillMetadataFromContent(content);
  } catch {
    return {};
  }
}

function readSkillDescription(path: string) {
  return readSkillMetadata(path).description;
}

function escapeSkillFrontMatter(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll(/\r?\n/g, " ").trim();
}

function renderSkillMarkdown(body: CreateSkillRequest) {
  const name = body.name.trim();
  const description = body.description.trim();
  const instructions = body.instructions.trim();
  return [
    "---",
    `name: "${escapeSkillFrontMatter(name)}"`,
    `description: "${escapeSkillFrontMatter(description)}"`,
    "---",
    "",
    `# ${name}`,
    "",
    description,
    "",
    "## Instructions",
    "",
    instructions,
    "",
  ].join("\n");
}

function findSkillFiles(root: string, depth = 3): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const entryPath = join(root, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") results.push(entryPath);
    if (entry.isDirectory()) results.push(...findSkillFiles(entryPath, depth - 1));
  }
  return results;
}

function listSkills(): ExtensionSummary[] {
  const roots = [join(codexHome, "skills"), join(codexHome, "plugins", "cache")];
  const seen = new Set<string>();
  const scannedAt = new Date().toISOString();
  return roots.flatMap((root) => findSkillFiles(root)).flatMap((skillPath) => {
    const folder = dirname(skillPath);
    if (seen.has(folder)) return [];
    seen.add(folder);
    const metadata = readSkillMetadata(skillPath);
    const isPluginCache = folder.includes(`${sep}plugins${sep}cache${sep}`);
    const isWebManaged = folder.includes(`${sep}skills${sep}web${sep}`);
    const name = metadata.name ?? basename(folder);
    return [{
      id: `skill:${folder}`,
      type: "skill" as const,
      name,
      description: metadata.description,
      path: folder,
      source: isPluginCache ? "plugin cache" : isWebManaged ? "web local" : "codex home",
      sourceType: isPluginCache ? "plugin_cache" as const : "codex_skill" as const,
      managedBy: isWebManaged ? "web" as const : "codex_cli" as const,
      syncStatus: "synced" as const,
      scannedAt,
      capabilityKinds: ["knowledge" as const],
      permissions: ["read_context"],
      enabled: true,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function createLocalSkill(body: CreateSkillRequest): ExtensionSummary {
  const name = body.name.trim().replaceAll(/\s+/g, " ");
  const description = body.description.trim().replaceAll(/\s+/g, " ");
  const instructions = body.instructions.trim();
  if (!name || !description || !instructions) throw new Error("invalid_skill");
  const folder = join(codexHome, "skills", "web", slugify(name));
  const skillPath = join(folder, "SKILL.md");
  if (existsSync(skillPath)) throw new Error("skill_exists");
  mkdirSync(folder, { recursive: true });
  writeFileSync(skillPath, renderSkillMarkdown({ name, description, instructions }), "utf8");
  const scannedAt = new Date().toISOString();
  return {
    id: `skill:${folder}`,
    type: "skill",
    name,
    description,
    path: folder,
    source: "web local",
    sourceType: "codex_skill",
    managedBy: "web",
    syncStatus: "synced",
    scannedAt,
    capabilityKinds: ["knowledge"],
    permissions: ["read_context"],
    enabled: true,
  };
}

function skillInstructionsFromContent(content: string) {
  const withoutFrontMatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/m, "").trim();
  const instructionMatch = withoutFrontMatter.match(/(?:^|\n)## Instructions\s*\n([\s\S]*)/i);
  if (instructionMatch?.[1]) return instructionMatch[1].trim();
  return withoutFrontMatter.replace(/^# .*\n+/, "").trim();
}

function normalizeImportUrl(url: string) {
  const githubBlob = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (githubBlob) return `https://raw.githubusercontent.com/${githubBlob[1]}/${githubBlob[2]}/${githubBlob[3]}/${githubBlob[4]}`;
  return url;
}

async function importSkill(body: ImportSkillRequest): Promise<ImportSkillResponse> {
  const rawContent = body.content?.trim();
  const url = body.url?.trim();
  let content = rawContent ?? "";
  if (!content && url) {
    content = await fetch(normalizeImportUrl(url), { redirect: "follow" }).then((response) => {
      if (!response.ok) throw new Error("skill_import_fetch_failed");
      return response.text();
    });
  }
  if (!content.trim()) throw new Error("skill_import_empty");
  const metadata = readSkillMetadataFromContent(content);
  const name = metadata.name?.trim() || (url ? basename(url).replace(/\.(md|markdown)$/i, "") : "");
  const description = metadata.description?.trim() || "Imported Skill";
  const instructions = skillInstructionsFromContent(content);
  if (!name || !instructions) throw new Error("skill_import_invalid");
  return { imported: createLocalSkill({ name, description, instructions }) };
}

function assertWebManagedSkillPath(path: string) {
  const root = resolve(codexHome, "skills", "web");
  const folder = resolve(path);
  if (folder !== root && !folder.startsWith(`${root}${sep}`)) throw new Error("skill_not_web_managed");
  const skillPath = join(folder, "SKILL.md");
  if (!existsSync(skillPath)) throw new Error("skill_not_found");
  return { folder, skillPath };
}

function updateLocalSkill(body: UpdateSkillRequest): ExtensionSummary {
  const { folder, skillPath } = assertWebManagedSkillPath(body.path);
  const name = body.name.trim().replaceAll(/\s+/g, " ");
  const description = body.description.trim().replaceAll(/\s+/g, " ");
  const instructions = body.instructions.trim();
  if (!name || !description || !instructions) throw new Error("invalid_skill");
  writeFileSync(skillPath, renderSkillMarkdown({ name, description, instructions }), "utf8");
  return {
    id: `skill:${folder}`,
    type: "skill",
    name,
    description,
    path: folder,
    source: "web local",
    sourceType: "codex_skill",
    managedBy: "web",
    syncStatus: "synced",
    scannedAt: new Date().toISOString(),
    capabilityKinds: ["knowledge"],
    permissions: ["read_context"],
    enabled: true,
  };
}

function deleteLocalSkill(body: DeleteSkillRequest) {
  const { folder } = assertWebManagedSkillPath(body.path);
  rmSync(folder, { recursive: true, force: true });
  return { ok: true, path: folder };
}

function findPluginManifests(root: string, depth = 4): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const entryPath = join(root, entry.name);
    if (entry.isFile() && entry.name === "plugin.json" && basename(dirname(entryPath)) === ".codex-plugin") results.push(entryPath);
    if (entry.isDirectory()) results.push(...findPluginManifests(entryPath, depth - 1));
  }
  return results;
}

function listPlugins(): ExtensionSummary[] {
  const roots = [join(codexHome, "plugins"), join(codexHome, "plugins", "cache")];
  const seen = new Set<string>();
  return roots.flatMap((root) => findPluginManifests(root)).flatMap((manifestPath) => {
    const pluginRoot = dirname(dirname(manifestPath));
    if (seen.has(pluginRoot)) return [];
    seen.add(pluginRoot);
    const manifest = readJsonFile(manifestPath);
    return [{
      id: `plugin:${pluginRoot}`,
      type: "plugin" as const,
      name: String(manifest?.name ?? basename(pluginRoot)),
      description: manifest?.description ? String(manifest.description) : undefined,
      path: pluginRoot,
      source: pluginRoot.includes("/plugins/cache/") ? "plugin cache" : "codex home",
      enabled: true,
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function createLocalPlugin(body: CreatePluginRequest): ExtensionSummary {
  const name = body.name.trim().replaceAll(/\s+/g, " ");
  if (!name) throw new Error("invalid_plugin");
  const description = body.description?.trim() || "";
  const pluginRoot = join(codexHome, "plugins", "web", slugify(name));
  const manifestDir = join(pluginRoot, ".codex-plugin");
  const manifestPath = join(manifestDir, "plugin.json");
  if (existsSync(manifestPath)) throw new Error("plugin_exists");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({
    name,
    version: "0.1.0",
    description,
  }, null, 2), "utf8");
  return {
    id: `plugin:${pluginRoot}`,
    type: "plugin",
    name,
    description,
    path: pluginRoot,
    source: "web local",
    sourceType: "codex_plugin",
    managedBy: "web",
    syncStatus: "synced",
    scannedAt: new Date().toISOString(),
    capabilityKinds: ["tool"],
    enabled: true,
  };
}

function listMcpServers(): ExtensionSummary[] {
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) return [];
  const content = readFileSync(configPath, "utf8");
  const matches = Array.from(content.matchAll(/^\[mcp_servers\.(?:"((?:\\.|[^"])*)"|([^\]]+))\]/gm));
  return matches.map((match) => ({
    id: `mcp:${match[1] ? JSON.parse(`"${match[1]}"`) : match[2]}`,
    type: "mcp" as const,
    name: match[1] ? JSON.parse(`"${match[1]}"`) : match[2],
    path: configPath,
    source: "config.toml",
    enabled: true,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function extensionTomlString(value: string) {
  return JSON.stringify(value);
}

function extensionTomlArray(values: string[]) {
  return `[${values.map(extensionTomlString).join(", ")}]`;
}

function renderMcpServerToml(body: CreateMcpServerRequest) {
  const args = body.args ?? [];
  const env = body.env ?? {};
  const lines = [
    `[mcp_servers.${extensionTomlString(body.name.trim())}]`,
    `command = ${extensionTomlString(body.command.trim())}`,
  ];
  if (args.length) lines.push(`args = ${extensionTomlArray(args)}`);
  if (Object.keys(env).length) {
    lines.push("env = { " + Object.entries(env).map(([key, value]) => `${key} = ${extensionTomlString(value)}`).join(", ") + " }");
  }
  return lines.join("\n");
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#34;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

const builtInMarketplaceCatalog: MarketplaceCatalog = {
  schemaVersion: 1,
  source: {
    id: "agentim-built-in",
    name: "AgentIM Built-in Catalog",
  },
  items: [],
};
const marketplaceCatalogSettingsKey = "marketplace_catalog";

function loadMarketplaceCatalog(): MarketplaceCatalogResponse {
  const catalog = loadJsonSetting<MarketplaceCatalog>(marketplaceCatalogSettingsKey, builtInMarketplaceCatalog);
  if (catalog?.schemaVersion !== 1 || !catalog.source?.id || !catalog.source?.name || !Array.isArray(catalog.items)) {
    return {
      source: builtInMarketplaceCatalog.source,
      items: builtInMarketplaceCatalog.items,
      fetchedAt: new Date().toISOString(),
    };
  }
  return {
    source: catalog.source,
    items: catalog.items.map(assertMarketplaceItem),
    fetchedAt: new Date().toISOString(),
  };
}

function saveMarketplaceCatalog(response: MarketplaceCatalogResponse) {
  const catalog: MarketplaceCatalog = {
    schemaVersion: 1,
    source: response.source,
    items: response.items.map(assertMarketplaceItem),
  };
  saveJsonSetting(marketplaceCatalogSettingsKey, catalog);
  return response;
}

function deleteMarketplaceCatalogItems(ids: string[]): MarketplaceCatalogResponse {
  const idSet = new Set(ids.map((value) => value.trim()).filter(Boolean));
  if (!idSet.size) return loadMarketplaceCatalog();
  const catalog = loadMarketplaceCatalog();
  return saveMarketplaceCatalog({
    ...catalog,
    items: catalog.items.filter((item) => !idSet.has(item.id)),
    fetchedAt: new Date().toISOString(),
  });
}

function clearMarketplaceCatalogItems(): MarketplaceCatalogResponse {
  const catalog = loadMarketplaceCatalog();
  return saveMarketplaceCatalog({
    ...catalog,
    items: [],
    fetchedAt: new Date().toISOString(),
  });
}

function normalizeMarketplaceMcpConfig(config: unknown): CreateMcpServerRequest[] {
  if (!config || typeof config !== "object") return [];
  const root = config as Record<string, unknown>;
  const servers = root.mcpServers && typeof root.mcpServers === "object" ? root.mcpServers as Record<string, unknown> : root;
  return Object.entries(servers).flatMap(([name, raw]) => {
    if (!raw || typeof raw !== "object") return [];
    const server = raw as Record<string, unknown>;
    const command = typeof server.command === "string" ? server.command.trim() : "";
    if (!command) return [];
    const args = Array.isArray(server.args) ? server.args.map(String) : [];
    const env = server.env && typeof server.env === "object"
      ? Object.fromEntries(Object.entries(server.env as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {};
    return [{ name, command, args, env }];
  });
}

function assertMarketplaceItem(value: unknown): MarketplaceCatalogItem {
  if (!value || typeof value !== "object") throw new Error("invalid_marketplace_item");
  const item = value as MarketplaceCatalogItem;
  if (!item.id || !item.name || !item.description || !item.type || !item.install) throw new Error("invalid_marketplace_item");
  if (item.type !== "skill" && item.type !== "mcp" && item.type !== "plugin") throw new Error("invalid_marketplace_type");
  return item;
}

function parseMarketplaceCatalog(content: string): MarketplaceCatalogResponse {
  const parsed = JSON.parse(content) as MarketplaceCatalog;
  if (parsed?.schemaVersion !== 1 || !parsed.source?.id || !parsed.source?.name || !Array.isArray(parsed.items)) throw new Error("invalid_marketplace_catalog");
  const items = parsed.items.map(assertMarketplaceItem);
  return {
    source: parsed.source,
    items,
    fetchedAt: new Date().toISOString(),
  };
}

async function importMarketplaceCatalog(body: ImportMarketplaceCatalogRequest): Promise<MarketplaceCatalogResponse> {
  const rawContent = body.content?.trim();
  const url = body.url?.trim();
  let content = rawContent ?? "";
  if (!content && url) {
    content = await fetch(url, { redirect: "follow" }).then((response) => {
      if (!response.ok) throw new Error("marketplace_catalog_fetch_failed");
      return response.text();
    });
  }
  if (!content.trim()) throw new Error("marketplace_catalog_empty");
  return parseMarketplaceCatalog(content);
}

async function installMarketplaceItem(body: InstallMarketplaceItemRequest): Promise<InstallMarketplaceItemResponse> {
  const item = assertMarketplaceItem(body.item);
  const install = item.install;
  if (item.type === "skill" && install.kind === "skill") return { installed: [createLocalSkill(install.skill)] };
  if (item.type === "skill" && install.kind === "skillUrl") {
    const result = await importSkill({ url: install.url });
    return { installed: [result.imported] };
  }
  if (item.type === "mcp" && install.kind === "mcpServers") {
    const candidates = normalizeMarketplaceMcpConfig(install.config);
    if (!candidates.length) throw new Error("marketplace_mcp_empty");
    return { installed: candidates.map((candidate) => createMcpServer(candidate)) };
  }
  if (item.type === "plugin" && install.kind === "plugin") return { installed: [createLocalPlugin(install.manifest)] };
  throw new Error("marketplace_install_mismatch");
}

function mcpCandidatesFromConfig(value: unknown): CreateMcpServerRequest[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const servers = root.mcpServers && typeof root.mcpServers === "object" ? root.mcpServers as Record<string, unknown> : null;
  if (!servers) return [];
  return Object.entries(servers).flatMap(([name, raw]) => {
    if (!raw || typeof raw !== "object") return [];
    const server = raw as Record<string, unknown>;
    const command = typeof server.command === "string" ? server.command : "";
    if (!command.trim()) return [];
    const args = Array.isArray(server.args) ? server.args.map(String) : [];
    const env = server.env && typeof server.env === "object"
      ? Object.fromEntries(Object.entries(server.env as Record<string, unknown>).map(([key, val]) => [key, String(val)]))
      : {};
    return [{ name, command, args, env }];
  });
}

function tryParseMcpJson(value: string) {
  try {
    return mcpCandidatesFromConfig(JSON.parse(value));
  } catch {
    return [];
  }
}

function extractMcpCandidates(content: string): CreateMcpServerRequest[] {
  const decoded = decodeHtmlEntities(content);
  const candidates: CreateMcpServerRequest[] = [];
  const seen = new Set<string>();
  const push = (items: CreateMcpServerRequest[]) => {
    for (const item of items) {
      const key = `${item.name}\n${item.command}\n${(item.args ?? []).join("\n")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(item);
    }
  };
  push(tryParseMcpJson(decoded));
  for (const fence of decoded.matchAll(/```(?:json|jsonc)?\s*([\s\S]*?)```/gi)) push(tryParseMcpJson(fence[1].trim()));
  for (const match of decoded.matchAll(/"mcpServers"\s*:/g)) {
    const start = decoded.lastIndexOf("{", match.index);
    if (start < 0) continue;
    for (let end = decoded.indexOf("}", match.index); end > 0 && end < decoded.length; end = decoded.indexOf("}", end + 1)) {
      const snippet = decoded.slice(start, end + 1);
      const parsed = tryParseMcpJson(snippet);
      if (parsed.length) {
        push(parsed);
        break;
      }
    }
  }
  return candidates;
}

function createMcpServer(body: CreateMcpServerRequest): ExtensionSummary {
  const name = body.name.trim();
  const command = body.command.trim();
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name) || !command) throw new Error("invalid_mcp_server");
  const configPath = join(codexHome, "config.toml");
  mkdirSync(dirname(configPath), { recursive: true });
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedQuotedName = extensionTomlString(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = new RegExp(`^\\[mcp_servers\\.(?:${escapedQuotedName}|${escapedName})\\][\\s\\S]*?(?=^\\[|\\s*$)`, "m");
  const section = renderMcpServerToml({ ...body, name, command });
  const next = sectionPattern.test(current)
    ? current.replace(sectionPattern, section)
    : [current.trimEnd(), section].filter(Boolean).join("\n\n");
  writeFileSync(configPath, `${next.trimEnd()}\n`, "utf8");
  return {
    id: `mcp:${name}`,
    type: "mcp",
    name,
    path: configPath,
    source: "config.toml",
    sourceType: "mcp_config",
    managedBy: "web",
    syncStatus: "synced",
    scannedAt: new Date().toISOString(),
    capabilityKinds: ["connector"],
    enabled: true,
  };
}

async function importMcpServers(body: ImportMcpServerRequest): Promise<ImportMcpServerResponse> {
  const rawContent = body.content?.trim();
  const url = body.url?.trim();
  let content = rawContent ?? "";
  if (!content && url) {
    content = await fetch(url, { redirect: "follow" }).then((response) => {
      if (!response.ok) throw new Error("mcp_import_fetch_failed");
      return response.text();
    });
  }
  if (!content.trim()) throw new Error("mcp_import_empty");
  const candidates = extractMcpCandidates(content);
  if (!candidates.length) throw new Error("mcp_import_no_candidates");
  const imported = candidates.map((candidate) => createMcpServer(candidate));
  return { imported, candidates };
}

function pageExtensions(items: ExtensionSummary[], limit = 20, cursorValue?: string | null, q = "") {
  const cursor = decodePageCursor(cursorValue);
  const query = q.trim().toLowerCase();
  const filtered = items
    .filter((item) => !query || [item.name, item.description, item.path, item.source, item.type].some((value) => value?.toLowerCase().includes(query)))
    .filter((item) => !cursor || item.name > cursor.sortValue || (item.name === cursor.sortValue && item.id > cursor.id))
    .slice(0, limit + 1);
  return pageFromRows(filtered, limit, (item) => item.name);
}

function assertInsideCodexHome(path: string) {
  const absolutePath = resolve(path);
  const relativePath = relative(codexHome, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) throw new Error("path_outside_codex_home");
  return absolutePath;
}

function readMcpConfigSection(name: string) {
  const configPath = join(codexHome, "config.toml");
  const content = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedQuotedName = extensionTomlString(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^\\[mcp_servers\\.(?:${escapedQuotedName}|${escapedName})\\][\\s\\S]*?(?=^\\[|\\s*$)`, "m"));
  return match?.[0]?.trim() || "";
}

function readExtensionDetail(type: ExtensionSummary["type"], name: string, path?: string): ExtensionDetail {
  if (type === "mcp") {
    const item: ExtensionSummary = {
      id: `mcp:${name}`,
      type,
      name,
      path: join(codexHome, "config.toml"),
      source: "config.toml",
      enabled: true,
    };
    return { item, format: "toml", content: readMcpConfigSection(name) };
  }
  if (!path) throw new Error("path_required");
  const rootPath = assertInsideCodexHome(path);
  if (type === "skill") {
    const skillPath = join(rootPath, "SKILL.md");
    const metadata = readSkillMetadata(skillPath);
    const isPluginCache = rootPath.includes(`${sep}plugins${sep}cache${sep}`);
    const isWebManaged = rootPath.includes(`${sep}skills${sep}web${sep}`);
    const item: ExtensionSummary = {
      id: `skill:${rootPath}`,
      type,
      name: name || metadata.name || basename(rootPath),
      description: metadata.description,
      path: rootPath,
      source: isPluginCache ? "plugin cache" : isWebManaged ? "web local" : "codex home",
      sourceType: isPluginCache ? "plugin_cache" : "codex_skill",
      managedBy: isWebManaged ? "web" : "codex_cli",
      syncStatus: "synced",
      scannedAt: new Date().toISOString(),
      capabilityKinds: ["knowledge"],
      permissions: ["read_context"],
      enabled: true,
    };
    return { item, format: "markdown", content: readFileSync(skillPath, "utf8") };
  }
  const manifestPath = join(rootPath, ".codex-plugin", "plugin.json");
  const manifest = readJsonFile(manifestPath);
  const item: ExtensionSummary = {
    id: `plugin:${rootPath}`,
    type,
    name: String(manifest?.name ?? name ?? basename(rootPath)),
    description: manifest?.description ? String(manifest.description) : undefined,
    path: rootPath,
    source: rootPath.includes("/plugins/cache/") ? "plugin cache" : "codex home",
    enabled: true,
  };
  return { item, format: "json", content: readFileSync(manifestPath, "utf8") };
}


  return {
    assertInsideCodexHome,
    clearMarketplaceCatalogItems,
    createLocalPlugin,
    createLocalSkill,
    createMcpServer,
    deleteLocalSkill,
    deleteMarketplaceCatalogItems,
    importMarketplaceCatalog,
    importMcpServers,
    importSkill,
    installMarketplaceItem,
    listMcpServers,
    listPlugins,
    listSkills,
    loadMarketplaceCatalog,
    pageExtensions,
    readExtensionDetail,
    readSkillMetadata,
    saveMarketplaceCatalog,
    updateLocalSkill,
  };
}
