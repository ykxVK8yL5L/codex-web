import type Database from "better-sqlite3";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { NotificationTestSettings, ProjectSummary, SystemBackupFileEntry, SystemBackupManifest, SystemBackupPreviewResponse, SystemBackupProjectReference, SystemBackupSettings } from "@codex-web/protocol";

type SettingsRuntimeDeps = {
  archiveExcluder: (patterns: string[]) => (path: string, isDirectory: boolean) => boolean;
  codexHome: string;
  createZipArchiveWithEntries: (entries: Array<{ name: string; data: Buffer | string; modifiedAt?: Date }>) => Buffer;
  dataDir: string;
  db: Database.Database;
  getAppData: () => { projects: ProjectSummary[] };
  getSystemBackupSettings: () => SystemBackupSettings;
  parseStoredZipArchive: (buffer: Buffer) => Array<{ name: string; data: Buffer }>;
  resolveTerminalCwd: (inputPath?: string) => string;
  runGitSync: (cwd: string, args: string[]) => { exitCode: number | null; stdout: string; stderr: string };
  sessionWorkspaceRoot: string;
};

export function createSettingsRuntime(deps: SettingsRuntimeDeps) {
  const { archiveExcluder, codexHome, createZipArchiveWithEntries, dataDir, db, getAppData, getSystemBackupSettings, parseStoredZipArchive, resolveTerminalCwd, runGitSync, sessionWorkspaceRoot } = deps;

function pathStats(targetPath: string, options: { excludeNames?: Set<string> } = {}) {
  try {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      return { bytes: stat.size, updatedAt: stat.mtime.toISOString() };
    }
    if (stat.isDirectory()) {
      let bytes = 0;
      for (const child of readdirSync(targetPath)) {
        if (options.excludeNames?.has(child)) continue;
        bytes += pathStats(join(targetPath, child), options).bytes;
      }
      return { bytes, updatedAt: stat.mtime.toISOString() };
    }
    return { bytes: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { bytes: 0, updatedAt: new Date(0).toISOString() };
  }
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeBackupEntryName(name: string) {
  const normalized = name.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) throw new Error("invalid_backup_entry");
  if (normalized.split("/").some((part) => part === "..")) throw new Error("invalid_backup_entry");
  return normalized;
}

function defaultSystemBackupSettings(): SystemBackupSettings {
  return {
    ignorePatterns: [
      "# 备份忽略规则，语法类似 .gitignore",
      "node_modules/",
      ".DS_Store",
    ],
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeSystemBackupSettings(input?: { ignorePatterns?: string[] | string; updatedAt?: string } | null): SystemBackupSettings {
  const rawPatterns = Array.isArray(input?.ignorePatterns)
    ? input!.ignorePatterns
    : typeof input?.ignorePatterns === "string"
      ? input.ignorePatterns.split(/\r?\n/)
      : defaultSystemBackupSettings().ignorePatterns;
  const ignorePatterns = rawPatterns
    .map((line: string) => String(line).replace(/\r/g, "").slice(0, 500))
    .slice(0, 500);
  return {
    ignorePatterns,
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
}

function loadSystemBackupSettings(): SystemBackupSettings {
  const row = db.prepare("select value from app_settings where key = 'system_backup'").get() as { value: string } | undefined;
  if (!row) return defaultSystemBackupSettings();
  try {
    return sanitizeSystemBackupSettings(JSON.parse(row.value) as Partial<SystemBackupSettings>);
  } catch {
    return defaultSystemBackupSettings();
  }
}

function saveSystemBackupSettings(settings: SystemBackupSettings) {
  db.prepare(`
    insert into app_settings (key, value, updated_at)
    values ('system_backup', ?, ?)
    on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(settings), settings.updatedAt);
}

function loadJsonSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("select value from app_settings where key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function saveJsonSetting(key: string, value: unknown) {
  const updatedAt = new Date().toISOString();
  db.prepare(`
    insert into app_settings (key, value, updated_at)
    values (?, ?, ?)
    on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), updatedAt);
}

const defaultNotificationTestSettings: NotificationTestSettings = {
  titleZh: "Codex Web 测试通知",
  titleEn: "Codex Web test notification",
  messageZh: "这是一条来自 Codex Web 的测试通知。",
  messageEn: "This is a test notification from Codex Web.",
  includeHelp: true,
  updatedAt: new Date().toISOString(),
};

function sanitizeNotificationTestSettings(input?: Partial<NotificationTestSettings> | null): NotificationTestSettings {
  return {
    titleZh: String(input?.titleZh ?? defaultNotificationTestSettings.titleZh).trim() || defaultNotificationTestSettings.titleZh,
    titleEn: String(input?.titleEn ?? defaultNotificationTestSettings.titleEn).trim() || defaultNotificationTestSettings.titleEn,
    messageZh: String(input?.messageZh ?? defaultNotificationTestSettings.messageZh).trim() || defaultNotificationTestSettings.messageZh,
    messageEn: String(input?.messageEn ?? defaultNotificationTestSettings.messageEn).trim() || defaultNotificationTestSettings.messageEn,
    includeHelp: input?.includeHelp !== false,
    updatedAt: String(input?.updatedAt ?? new Date().toISOString()),
  };
}

function loadNotificationTestSettings() {
  return sanitizeNotificationTestSettings(loadJsonSetting<NotificationTestSettings>("notification_test_settings", defaultNotificationTestSettings));
}

function saveNotificationTestSettings(settings: NotificationTestSettings) {
  saveJsonSetting("notification_test_settings", settings);
}

function decodeTomlQuotedKey(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function shouldPruneCodexProjectTrustPath(value: string) {
  const absolutePath = resolve(value);
  const sessionRoot = resolve(sessionWorkspaceRoot);
  return absolutePath === sessionRoot || absolutePath.startsWith(`${sessionRoot}${sep}`);
}

function pruneCodexSessionProjectTrustEntries() {
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) return 0;
  const content = readFileSync(configPath, "utf8");
  const lines = content.split(/\r?\n/);
  const nextLines: string[] = [];
  let pruned = 0;
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const match = line.match(/^\[projects\.(?:"((?:\\.|[^"])*)"|([^\]]+))\]\s*$/);
    if (!match) {
      nextLines.push(line);
      index += 1;
      continue;
    }
    const projectPath = match[1] ? decodeTomlQuotedKey(match[1]) : match[2];
    const section: string[] = [line];
    index += 1;
    while (index < lines.length && !lines[index].startsWith("[")) {
      section.push(lines[index]);
      index += 1;
    }
    if (projectPath && shouldPruneCodexProjectTrustPath(projectPath)) {
      pruned += 1;
      continue;
    }
    nextLines.push(...section);
  }
  if (pruned) {
    writeFileSync(`${configPath}.codex-web-prune.bak`, content, "utf8");
    writeFileSync(configPath, nextLines.join("\n"), "utf8");
  }
  return pruned;
}

function dataBackupEntries(rootName: string) {
  const entries: Array<{ name: string; data: Buffer; modifiedAt?: Date }> = [];
  const rootPath = resolve(dataDir);
  const shouldExclude = archiveExcluder(getSystemBackupSettings().ignorePatterns);

  function walk(absolutePath: string, relativePath: string) {
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return;
    if (relativePath && shouldExclude(relativePath, stat.isDirectory())) return;
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolutePath)) walk(join(absolutePath, name), relativePath ? `${relativePath}/${name}` : name);
      return;
    }
    if (!stat.isFile()) return;
    const archivePath = safeBackupEntryName(`${rootName}/app-data/${relativePath}`);
    entries.push({ name: archivePath, data: readFileSync(absolutePath), modifiedAt: stat.mtime });
  }

  if (existsSync(rootPath)) walk(rootPath, "");
  return entries;
}

function archiveFileEntries(entries: Array<{ name: string; data: Buffer | string; modifiedAt?: Date }>, rootName?: string): SystemBackupFileEntry[] {
  const prefix = rootName ? `${rootName}/` : "";
  return entries.map((entry) => ({
    path: prefix && entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : entry.name,
    bytes: Buffer.isBuffer(entry.data) ? entry.data.length : Buffer.byteLength(entry.data),
    modifiedAt: entry.modifiedAt?.toISOString() ?? null,
  }));
}

function gitValue(cwd: string, args: string[]) {
  const result = runGitSync(cwd, args);
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

function projectBackupReferences(): SystemBackupProjectReference[] {
  return getAppData().projects.map((project) => {
    let workspacePath = project.workspacePath;
    let exists = false;
    try {
      workspacePath = resolveTerminalCwd(project.workspacePath);
      exists = existsSync(workspacePath);
    } catch {
      workspacePath = project.workspacePath;
    }
    const gitRemote = exists ? gitValue(workspacePath, ["config", "--get", "remote.origin.url"]) : null;
    const gitBranch = exists ? gitValue(workspacePath, ["branch", "--show-current"]) : null;
    const gitCommit = exists ? gitValue(workspacePath, ["rev-parse", "HEAD"]) : null;
    const dirtyOutput = exists ? gitValue(workspacePath, ["status", "--short"]) : null;
    const gitDirty = exists ? Boolean(dirtyOutput) : null;
    return {
      id: project.id,
      name: project.name,
      workspacePath,
      exists,
      gitRemote,
      gitBranch,
      gitCommit,
      gitDirty,
      included: false,
      note: "真实项目源码目录不会随系统备份打包；这里只记录路径和 Git 参考信息。",
    };
  });
}

function buildSystemBackupManifest(warnings: string[] = []): SystemBackupManifest {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    app: "codex-web",
    dataDir,
    ignorePatterns: getSystemBackupSettings().ignorePatterns,
    included: [
      "apps/api/data/**",
      "备份清单 manifest.json",
      "已绑定项目的路径与 Git 参考信息",
    ],
    excluded: [
      "apps/api/data 之外的真实项目源码目录",
      "构建产物和外部挂载目录",
      "用户配置的备份忽略规则匹配到的 apps/api/data 内文件",
    ],
    projects: projectBackupReferences(),
    warnings: [
      "真实项目目录不会随系统备份打包；还原后如果路径不存在，需要重新绑定项目目录。",
      "Provider API Key 等应用状态会随 apps/api/data 一起备份。请妥善保管备份文件。",
      ...warnings,
    ],
  };
}

function createSystemBackupArchive() {
  const warnings: string[] = [];
  try {
    db.pragma("wal_checkpoint(FULL)");
  } catch {
    warnings.push("SQLite WAL checkpoint 失败，备份仍会继续，但正在写入的数据可能需要重启后再备份一次。");
  }
  const rootName = `codex-web-system-backup-${backupTimestamp()}`;
  const manifest = buildSystemBackupManifest(warnings);
  const entries = [
    { name: `${rootName}/manifest.json`, data: `${JSON.stringify(manifest, null, 2)}\n`, modifiedAt: new Date(manifest.createdAt) },
    ...dataBackupEntries(rootName),
  ];
  const buffer = createZipArchiveWithEntries(entries);
  return { manifest, buffer, entries: entries.length, files: archiveFileEntries(entries, rootName), bytes: buffer.length };
}

function readSystemBackupArchive(buffer: Buffer) {
  const entries = parseStoredZipArchive(buffer);
  const manifestEntry = entries.find((entry) => entry.name.endsWith("/manifest.json") || entry.name === "manifest.json");
  if (!manifestEntry) throw new Error("backup_manifest_missing");
  const rootName = manifestEntry.name.includes("/") ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf("/")) : "";
  const manifest = JSON.parse(manifestEntry.data.toString("utf8")) as SystemBackupManifest;
  if (manifest.app !== "codex-web" || manifest.schemaVersion !== 1) throw new Error("backup_manifest_unsupported");
  const prefix = rootName ? `${rootName}/app-data/` : "app-data/";
  const appDataEntries = entries
    .filter((entry) => entry.name.startsWith(prefix))
    .map((entry) => {
      const relativePath = safeBackupEntryName(entry.name.slice(prefix.length));
      if (!relativePath) throw new Error("invalid_backup_entry");
      return { relativePath, data: entry.data };
    });
  const files = appDataEntries.map((entry) => ({
    path: `app-data/${entry.relativePath}`,
    bytes: entry.data.length,
    modifiedAt: null,
  } satisfies SystemBackupFileEntry));
  return { manifest, entries: appDataEntries, files, bytes: buffer.length };
}

function systemBackupPreviewFromArchive(buffer: Buffer): SystemBackupPreviewResponse {
  const parsed = readSystemBackupArchive(buffer);
  return {
    ok: true,
    manifest: parsed.manifest,
    entries: parsed.entries.length,
    files: parsed.files,
    bytes: parsed.bytes,
    restartRequired: true,
  };
}

async function readBackupUpload(c: { req: { formData: () => Promise<FormData> } }) {
  const form = await c.req.formData();
  const file = form.get("backup");
  if (!file || typeof file === "string" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    throw new Error("backup_file_required");
  }
  return Buffer.from(await (file as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer());
}



  return {
    backupTimestamp,
    buildSystemBackupManifest,
    createSystemBackupArchive,
    dataBackupEntries,
    defaultSystemBackupSettings,
    loadJsonSetting,
    loadNotificationTestSettings,
    loadSystemBackupSettings,
    pathStats,
    projectBackupReferences,
    pruneCodexSessionProjectTrustEntries,
    readBackupUpload,
    readSystemBackupArchive,
    safeBackupEntryName,
    sanitizeNotificationTestSettings,
    sanitizeSystemBackupSettings,
    saveJsonSetting,
    saveNotificationTestSettings,
    saveSystemBackupSettings,
    systemBackupPreviewFromArchive,
  };
}
