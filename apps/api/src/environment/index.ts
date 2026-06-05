import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type {
  EnvironmentOverview,
  EnvironmentPackageDetailResponse,
  EnvironmentPackageRecord,
  EnvironmentProjectUsage,
  EnvironmentReconcileItem,
  EnvironmentRestoreMissingRequest,
  EnvironmentRestorePreviewItem,
  EnvironmentRestorePreviewResponse,
  EnvironmentRestoreRun,
  EnvironmentToolProbe,
  EnvironmentToolRecord,
  EnvironmentToolRegistryItem,
  EnvironmentToolVersionItem,
  InstallEnvironmentPackageRequest,
  InstallEnvironmentToolRequest,
  RegisterEnvironmentToolRequest,
  UninstallEnvironmentPackageRequest,
} from "@codex-web/protocol";
import { createEnvironmentPackageRegistry, packageInstallCommandSpec, packageUninstallCommandSpec, packageUninstallCommandText } from "./packages.js";

type EnvironmentDeps = {
  appProjects: Array<{ id: string; name: string; workspacePath: string }>;
  commandVersion: (command: string, args: string[]) => string | null;
  loadJsonSetting: <T>(key: string, fallback: T) => T;
  managedChildEnv: (extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  resolveMiseCommand: () => string;
  resolveTerminalCwd: (inputPath?: string) => string;
  saveJsonSetting: (key: string, value: unknown) => void;
};

let deps: EnvironmentDeps | null = null;
const environmentPackageRegistryState = {
  registry: null as ReturnType<typeof createEnvironmentPackageRegistry> | null,
};

function getDeps() {
  if (!deps) throw new Error("environment_store_not_initialized");
  return deps;
}

function packageRegistry() {
  if (!environmentPackageRegistryState.registry) {
    environmentPackageRegistryState.registry = createEnvironmentPackageRegistry((command, args) => getDeps().commandVersion(command, args));
  }
  return environmentPackageRegistryState.registry;
}

export function setEnvironmentStoreDeps(nextDeps: EnvironmentDeps) {
  deps = nextDeps;
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function commandVersion(command: string, args: string[]) {
  return getDeps().commandVersion(command, args);
}

function isPythonTool(tool?: string | null) {
  const key = tool?.trim().toLowerCase();
  return key === "python" || key === "python3";
}

function isMisePythonAttestationFailure(result: ReturnType<typeof spawnSync>) {
  const output = [result.stderr, result.stdout].join("\n").toLowerCase();
  return output.includes("github artifact attestations")
    || output.includes("mise_python_github_attestations")
    || output.includes("attestation verification");
}

function runMiseUseGlobal(tool: string, target: string) {
  const command = getDeps().resolveMiseCommand();
  const result = spawnSync(command, ["use", "-g", target], { encoding: "utf8" });
  if (result.status === 0 || !isPythonTool(tool) || !isMisePythonAttestationFailure(result)) return result;
  return spawnSync(command, ["use", "-g", target], {
    encoding: "utf8",
    env: getDeps().managedChildEnv({ MISE_PYTHON_GITHUB_ATTESTATIONS: "false" }),
  });
}

function detectToolVersion(tool: string) {
  const key = tool.trim().toLowerCase();
  if (!key) return null;
  if (key === "node") return commandVersion("node", ["-v"]) ?? miseExecVersion("node", ["-v"]);
  if (key === "pnpm") return commandVersion("pnpm", ["-v"]) ?? miseExecVersion("pnpm", ["-v"]);
  if (key === "python" || key === "python3") return commandVersion("python3", ["--version"]) ?? commandVersion("python", ["--version"]) ?? miseExecVersion("python", ["--version"]);
  if (key === "git") return commandVersion("git", ["--version"]) ?? miseExecVersion("git", ["--version"]);
  if (key === "uv") return commandVersion("uv", ["--version"]) ?? miseExecVersion("uv", ["--version"]);
  if (key === "ffmpeg") return commandVersion("ffmpeg", ["-version"]) ?? miseExecVersion("ffmpeg", ["-version"]);
  if (key === "go") return commandVersion("go", ["version"]) ?? miseExecVersion("go", ["version"]);
  if (key === "bun") return commandVersion("bun", ["--version"]) ?? miseExecVersion("bun", ["--version"]);
  if (key === "mise") return commandVersion(getDeps().resolveMiseCommand(), ["--version"]);
  return commandVersion(key, ["--version"]) ?? commandVersion(key, ["version"]) ?? miseExecVersion(key, ["--version"]) ?? miseExecVersion(key, ["version"]);
}

function miseExecVersion(command: string, args: string[]) {
  try {
    const result = spawnSync(getDeps().resolveMiseCommand(), ["exec", "--", command, ...args], { encoding: "utf8" });
    if (result.status !== 0) return null;
    return [result.stdout, result.stderr].join("\n").trim().split(/\r?\n/)[0] || "installed";
  } catch {
    return null;
  }
}

export function detectMiseStatus() {
  try {
    const result = spawnSync(getDeps().resolveMiseCommand(), ["--version"], { encoding: "utf8" });
    const output = [result.stdout, result.stderr].join("\n");
    const versionLine = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("[WARN]") && !line.startsWith("mise WARN")) ?? null;
    const warningLine = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("[WARN]") || line.startsWith("mise WARN")) ?? null;
    return {
      installed: result.status === 0,
      version: versionLine,
      warning: warningLine,
    };
  } catch {
    return {
      installed: false,
      version: null,
      warning: "mise_not_installed",
    };
  }
}

function parseRegistryLines(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("[WARN]") && !line.startsWith("mise WARN"))
    .map((line) => {
      const match = line.match(/^(\S+)\s+(.*)$/);
      if (!match) return null;
      const name = match[1]?.trim();
      const rest = match[2]?.trim() ?? "";
      if (!name) return null;
      const backend = rest.split(/\s+/)[0]?.trim() || null;
      return { name, description: rest || null, backend };
    })
    .filter((item): item is EnvironmentToolRegistryItem => Boolean(item));
}

export function listEnvironmentToolRegistry(query?: string) {
  const trimmed = query?.trim();
  const args = trimmed ? ["search", trimmed] : ["registry"];
  try {
    const result = spawnSync(getDeps().resolveMiseCommand(), args, { encoding: "utf8" });
    if (result.status !== 0) return [];
    const items = parseRegistryLines([result.stdout, result.stderr].join("\n"));
    return items.slice(0, trimmed ? 100 : 400);
  } catch {
    return [];
  }
}

export function probeEnvironmentTool(tool: string): EnvironmentToolProbe {
  const detectedVersion = detectToolVersion(tool);
  return { tool, detectedVersion, installed: Boolean(detectedVersion) };
}

export function listEnvironmentToolVersions(tool: string) {
  const trimmed = tool.trim();
  if (!trimmed) return { items: [] as EnvironmentToolVersionItem[], error: "tool_required" as string | null };
  try {
    const result = spawnSync(getDeps().resolveMiseCommand(), ["ls-remote", trimmed], { encoding: "utf8" });
    if (result.status !== 0) {
      return {
        items: [] as EnvironmentToolVersionItem[],
        error: [result.stderr, result.stdout].join("\n").trim() || "environment_versions_failed",
      };
    }
    const items = [result.stdout, result.stderr]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("[WARN]") && !line.startsWith("mise WARN"))
      .map((line) => {
        const version = line.split(/\s+/)[0]?.trim();
        return version ? ({ version } satisfies EnvironmentToolVersionItem) : null;
      })
      .filter((item): item is EnvironmentToolVersionItem => Boolean(item))
      .sort((a, b) => compareSemverDesc(a.version, b.version));
    const recommended = recommendEnvironmentToolVersions(trimmed, items);
    const historical = items.filter((item) => !recommended.some((entry) => entry.version === item.version)).slice(0, 80);
    return { items: recommended, history: historical, error: null };
  } catch (error) {
    return {
      items: [] as EnvironmentToolVersionItem[],
      history: [] as EnvironmentToolVersionItem[],
      error: error instanceof Error ? error.message : "environment_versions_failed",
    };
  }
}

function compareSemverDesc(a: string, b: string) {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part.replace(/\D.*$/g, ""), 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

function recommendEnvironmentToolVersions(tool: string, items: EnvironmentToolVersionItem[]) {
  const normalized = tool.trim().toLowerCase();
  if (!items.length) return [];
  if (normalized === "node" || normalized === "python" || normalized === "bun") {
    const latestByMajor = new Map<number, EnvironmentToolVersionItem>();
    for (const item of items) {
      const major = Number.parseInt(item.version.split(".")[0] ?? "", 10);
      if (!Number.isFinite(major)) continue;
      if (!latestByMajor.has(major)) latestByMajor.set(major, item);
    }
    return Array.from(latestByMajor.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, 6)
      .map(([, item], index) => ({ ...item, recommended: index < 3 }));
  }
  return items.slice(0, 12).map((item, index) => ({ ...item, recommended: index < 6 }));
}

export function buildEnvironmentOverview(): EnvironmentOverview {
  const { appProjects, loadJsonSetting, resolveTerminalCwd } = getDeps();
  const raw = loadJsonSetting<EnvironmentOverview>("environment_overview", {
    tools: [],
    packageRecords: [],
    restoreRuns: [],
    reconcile: [],
    projectUsage: [],
    mise: {
      installed: false,
      version: null,
      warning: null,
    },
    updatedAt: new Date().toISOString(),
  });
  const tools = Array.isArray(raw.tools) ? raw.tools : [];
  const packageRecords = Array.isArray(raw.packageRecords) ? raw.packageRecords : [];
  const restoreRuns = Array.isArray(raw.restoreRuns) ? raw.restoreRuns : [];
  const mise = detectMiseStatus();
  const currentOutput = (() => {
    try {
      const result = spawnSync(getDeps().resolveMiseCommand(), ["current"], { encoding: "utf8" });
      return result.status === 0 ? [result.stdout, result.stderr].join("\n") : "";
    } catch {
      return "";
    }
  })();
  const normalizedTools = tools.map((tool) => {
    const detectedVersion = detectToolVersion(tool.tool);
    const status: EnvironmentToolRecord["status"] = detectedVersion
      ? (tool.requestedVersion && !detectedVersion.includes(tool.requestedVersion) ? "version_mismatch" : "installed")
      : "missing";
    const isGlobalDefault = currentOutput.split(/\r?\n/).some((line) => {
      const normalized = line.trim().toLowerCase();
      return normalized.startsWith(`${tool.tool.toLowerCase()} `) && normalized.includes(tool.requestedVersion.toLowerCase());
    });
    return { ...tool, detectedVersion, isGlobalDefault, status, updatedAt: new Date().toISOString() };
  });
  const normalizedPackageRecords = packageRecords.map((pkg) => {
    const toolRecord = normalizedTools.find((tool) => tool.id === pkg.toolRecordId) ?? null;
    const runtimeMissing = toolRecord?.status === "missing";
    const runtimeMismatch = toolRecord?.status === "version_mismatch";
    const pkgStatus = runtimeMissing ? "missing" : runtimeMismatch ? "failed" : pkg.status ?? "installed";
    return { ...pkg, status: pkgStatus, updatedAt: new Date().toISOString() };
  });
  const reconcile: EnvironmentReconcileItem[] = [];
  for (const tool of normalizedTools) {
    if (tool.status === "missing") {
      reconcile.push({
        id: `reconcile-tool-missing-${tool.id}`,
        kind: "tool",
        status: "missing_runtime",
        title: `${tool.tool}@${tool.requestedVersion}`,
        detail: "Recorded runtime is missing locally.",
        toolRecordId: tool.id,
      });
    } else if (tool.status === "version_mismatch") {
      reconcile.push({
        id: `reconcile-tool-version-${tool.id}`,
        kind: "tool",
        status: "runtime_version_mismatch",
        title: `${tool.tool}@${tool.requestedVersion}`,
        detail: `Detected ${tool.detectedVersion ?? "unknown"} locally.`,
        toolRecordId: tool.id,
      });
    }
  }
  for (const pkg of normalizedPackageRecords) {
    if (pkg.status === "missing") {
      reconcile.push({
        id: `reconcile-pkg-missing-${pkg.id}`,
        kind: "package",
        status: "missing_package",
        title: `${pkg.packageName} · ${pkg.manager}`,
        detail: `Missing from ${pkg.targetLabel}.`,
        toolRecordId: pkg.toolRecordId ?? null,
        packageRecordId: pkg.id,
      });
    } else if (pkg.versionSpec && pkg.installedVersion && pkg.versionSpec !== pkg.installedVersion) {
      reconcile.push({
        id: `reconcile-pkg-version-${pkg.id}`,
        kind: "package",
        status: "package_version_mismatch",
        title: `${pkg.packageName} · ${pkg.manager}`,
        detail: `Recorded ${pkg.versionSpec}, detected ${pkg.installedVersion}.`,
        toolRecordId: pkg.toolRecordId ?? null,
        packageRecordId: pkg.id,
      });
    }
  }
  const projectUsage: EnvironmentProjectUsage[] = appProjects.map((project) => {
    const detectedFiles: string[] = [];
    const matchedTools = new Set<string>();
    try {
      const root = resolveTerminalCwd(project.workspacePath);
      const probes: Array<{ file: string; tool: string }> = [
        { file: "package.json", tool: "node" },
        { file: "pnpm-lock.yaml", tool: "node" },
        { file: "requirements.txt", tool: "python" },
        { file: "pyproject.toml", tool: "python" },
        { file: "go.mod", tool: "go" },
        { file: "Cargo.toml", tool: "rust" },
        { file: "Gemfile", tool: "ruby" },
        { file: "composer.json", tool: "php" },
        { file: "deno.json", tool: "deno" },
        { file: "pubspec.yaml", tool: "dart" },
      ];
      for (const probe of probes) {
        if (existsSync(join(root, probe.file))) {
          detectedFiles.push(probe.file);
          matchedTools.add(probe.tool);
        }
      }
    } catch {}
    return {
      projectId: project.id,
      projectName: project.name,
      workspacePath: project.workspacePath,
      matchedTools: [...matchedTools],
      detectedFiles,
    };
  }).filter((item) => item.matchedTools.length || item.detectedFiles.length);
  return {
    tools: normalizedTools,
    packageRecords: normalizedPackageRecords,
    restoreRuns,
    reconcile,
    projectUsage,
    mise: {
      installed: Boolean(mise.installed),
      version: mise.version ?? null,
      warning: mise.warning ?? null,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function saveEnvironmentOverview(overview: EnvironmentOverview) {
  getDeps().saveJsonSetting("environment_overview", overview);
}

export function listPackagesForToolRecord(overview: EnvironmentOverview, toolRecord: EnvironmentToolRecord) {
  return overview.packageRecords
    .filter((item) => item.toolRecordId === toolRecord.id)
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
}

export function buildEnvironmentRestorePreview(toolRecord: EnvironmentToolRecord, packages: EnvironmentPackageRecord[]): EnvironmentRestorePreviewItem[] {
  const items: EnvironmentRestorePreviewItem[] = [];
  items.push({
    id: `preview-tool-${toolRecord.id}`,
    kind: "tool",
    action: toolRecord.status === "missing" ? "install" : toolRecord.status === "version_mismatch" ? "manual" : "record",
    title: `${toolRecord.tool}@${toolRecord.requestedVersion}`,
    detail: toolRecord.status === "missing"
      ? "Runtime needs installation."
      : toolRecord.status === "version_mismatch"
        ? `Detected ${toolRecord.detectedVersion ?? "unknown"} locally.`
        : "Runtime already available locally.",
    command: toolRecord.source === "mise" ? `mise use -g ${toolRecord.tool}@${toolRecord.requestedVersion}` : null,
    toolRecordId: toolRecord.id,
  });
  for (const pkg of packages) {
    items.push({
      id: `preview-package-${pkg.id}`,
      kind: "package",
      action: environmentPackageManualCleanup(pkg.manager)
        ? "manual"
        : pkg.persisted
          ? "record"
          : pkg.status === "missing"
            ? "install"
            : "record",
      title: `${pkg.packageName} · ${pkg.manager}`,
      detail: environmentPackageManualCleanup(pkg.manager)
        ? "Requires manual cleanup or manual install review."
        : pkg.status === "missing"
          ? `Will install into ${pkg.targetLabel}.`
          : `Will record or keep existing install for ${pkg.targetLabel}.`,
      command: pkg.status === "missing" ? pkg.installCommand : null,
      toolRecordId: pkg.toolRecordId ?? null,
      packageRecordId: pkg.id,
    });
  }
  return items;
}

function environmentPackageManualCleanup(manager: string) {
  return manager === "go-install" || manager === "shards";
}

function summarizeEnvironmentRestoreRun(status: EnvironmentRestoreRun["status"], lines: string[]) {
  const content = lines.filter(Boolean).join("; ").trim();
  return content || (status === "success" ? "Environment restore completed" : status === "partial" ? "Environment restore partially completed" : "Environment restore failed");
}

function environmentRestoreSelectionMatches(mode: "all" | "auto", autoRestore: boolean) {
  return mode === "all" || autoRestore;
}

export function buildEnvironmentRestoreExecutionPlan(body?: EnvironmentRestoreMissingRequest): EnvironmentRestorePreviewResponse {
  const overview = buildEnvironmentOverview();
  const mode = body?.mode === "all" ? "all" : "auto";
  const includeTools = body?.includeTools !== false;
  const includePackages = body?.includePackages !== false;
  const items: EnvironmentRestorePreviewItem[] = [];
  let tools = 0;
  let packages = 0;
  if (includeTools) {
    for (const tool of overview.tools.filter((item) => item.status === "missing" && environmentRestoreSelectionMatches(mode, item.autoRestore))) {
      tools += 1;
      items.push({
        id: `restore-tool-${tool.id}`,
        kind: "tool",
        action: tool.source === "mise" ? "install" : "manual",
        title: `${tool.tool}@${tool.requestedVersion}`,
        detail: tool.source === "mise"
          ? "Missing runtime will be installed."
          : `Missing runtime is tracked as ${tool.source} and requires manual restore.`,
        command: tool.source === "mise" ? `mise use -g ${tool.tool}@${tool.requestedVersion}` : null,
        toolRecordId: tool.id,
      });
    }
  }
  if (includePackages) {
    for (const pkg of overview.packageRecords.filter((item) => item.status === "missing" && environmentRestoreSelectionMatches(mode, item.autoRestore))) {
      packages += 1;
      const tool = pkg.toolRecordId ? overview.tools.find((entry) => entry.id === pkg.toolRecordId) ?? null : null;
      const runtimeMissing = tool?.status === "missing";
      const commandSpec = packageInstallCommandSpec(pkg.manager, pkg.packageName, pkg.versionSpec ?? null);
      const action: EnvironmentRestorePreviewItem["action"] = runtimeMissing || !commandSpec || environmentPackageManualCleanup(pkg.manager) ? "manual" : "install";
      items.push({
        id: `restore-package-${pkg.id}`,
        kind: "package",
        action,
        title: `${pkg.packageName} · ${pkg.manager}`,
        detail: runtimeMissing
          ? `Runtime ${tool?.tool ?? pkg.tool} is missing and must be restored first.`
          : !commandSpec || environmentPackageManualCleanup(pkg.manager)
            ? `Package manager ${pkg.manager} requires manual restore handling.`
            : `Missing package will be installed into ${pkg.targetLabel}.`,
        command: action === "install" && commandSpec ? commandSpec.text : null,
        toolRecordId: pkg.toolRecordId ?? null,
        packageRecordId: pkg.id,
      });
    }
  }
  return { items, tools, packages };
}

export function runEnvironmentRestoreMissing(currentOverview: EnvironmentOverview, body?: EnvironmentRestoreMissingRequest) {
  const mode = body?.mode === "all" ? "all" : "auto";
  const includeTools = body?.includeTools !== false;
  const includePackages = body?.includePackages !== false;
  const now = new Date().toISOString();
  const startedOverview = buildEnvironmentOverview();
  const summaryLines: string[] = [];
  let successCount = 0;
  let failureCount = 0;
  let nextOverview = currentOverview;

  if (includeTools) {
    const tools = startedOverview.tools.filter((item) => item.status === "missing" && environmentRestoreSelectionMatches(mode, item.autoRestore));
    let installedTools = 0;
    let skippedTools = 0;
    let failedTools = 0;
    for (const tool of tools) {
      if (tool.source !== "mise") {
        skippedTools += 1;
        continue;
      }
      const result = runMiseUseGlobal(tool.tool, `${tool.tool}@${tool.requestedVersion}`);
      if (result.status === 0) {
        installedTools += 1;
        successCount += 1;
      } else {
        failedTools += 1;
        failureCount += 1;
      }
    }
    if (tools.length) summaryLines.push(`runtimes ${installedTools}/${tools.length} restored${skippedTools ? `, ${skippedTools} manual` : ""}${failedTools ? `, ${failedTools} failed` : ""}`);
  }

  let refreshedOverview = buildEnvironmentOverview();
  if (includePackages) {
    const packages = refreshedOverview.packageRecords.filter((item) => item.status === "missing" && environmentRestoreSelectionMatches(mode, item.autoRestore));
    let installedPackages = 0;
    let skippedPackages = 0;
    let failedPackages = 0;
    const updatedRecords = [...refreshedOverview.packageRecords];
    for (const pkg of packages) {
      const tool = pkg.toolRecordId ? refreshedOverview.tools.find((entry) => entry.id === pkg.toolRecordId) ?? null : null;
      if (tool?.status === "missing") {
        skippedPackages += 1;
        continue;
      }
      const commandSpec = packageInstallCommandSpec(pkg.manager, pkg.packageName, pkg.versionSpec ?? null);
      if (!commandSpec || environmentPackageManualCleanup(pkg.manager)) {
        skippedPackages += 1;
        continue;
      }
      const probe = packageRegistry().inspectEnvironmentPackage(pkg.manager, pkg.packageName);
      const result = probe.installed ? { status: 0, stdout: "already installed", stderr: "" } : spawnSync(commandSpec.command, commandSpec.args, { encoding: "utf8" });
      const index = updatedRecords.findIndex((item) => item.id === pkg.id);
      if (result.status === 0) {
        installedPackages += 1;
        successCount += 1;
        if (index >= 0) {
          updatedRecords[index] = {
            ...updatedRecords[index],
            persisted: true,
            status: "installed" as const,
            installedVersion: probe.version ?? pkg.versionSpec ?? updatedRecords[index].installedVersion ?? null,
            updatedAt: now,
          } as EnvironmentPackageRecord;
        }
      } else {
        failedPackages += 1;
        failureCount += 1;
        if (index >= 0) updatedRecords[index] = { ...updatedRecords[index], status: "failed" as const, updatedAt: now } as EnvironmentPackageRecord;
      }
    }
    refreshedOverview = { ...refreshedOverview, packageRecords: updatedRecords, updatedAt: now };
    saveEnvironmentOverview(refreshedOverview);
    if (packages.length) summaryLines.push(`packages ${installedPackages}/${packages.length} restored${skippedPackages ? `, ${skippedPackages} manual` : ""}${failedPackages ? `, ${failedPackages} failed` : ""}`);
  }

  const finalOverview = buildEnvironmentOverview();
  const status: EnvironmentRestoreRun["status"] = failureCount === 0 ? "success" : successCount > 0 ? "partial" : "failed";
  nextOverview = {
    ...finalOverview,
    restoreRuns: [
      {
        id: `env-restore-${Math.random().toString(36).slice(2)}`,
        status,
        summary: summarizeEnvironmentRestoreRun(status, summaryLines),
        createdAt: now,
      },
      ...finalOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(nextOverview);
  return nextOverview;
}

export function installMise(currentOverview: EnvironmentOverview) {
  const home = process.env.HOME;
  if (!home) throw new Error("home_not_available");
  const installPath = join(home, ".local/bin/mise");
  const installScript = [
    "set -euo pipefail",
    "mkdir -p \"$HOME/.local/bin\"",
    "tmp=\"$(mktemp)\"",
    "trap 'rm -f \"$tmp\"' EXIT",
    "curl -fsSL https://mise.run -o \"$tmp\"",
    "MISE_INSTALL_PATH=\"$HOME/.local/bin/mise\" sh \"$tmp\"",
    "\"$HOME/.local/bin/mise\" --version",
  ].join(" && ");
  const result = spawnSync("/bin/bash", ["-lc", installScript], {
    encoding: "utf8",
    env: getDeps().managedChildEnv(),
  });
  const verification = spawnSync(installPath, ["--version"], { encoding: "utf8" });
  const installed = result.status === 0 && verification.status === 0;
  const now = new Date().toISOString();
  const next: EnvironmentOverview = { ...buildEnvironmentOverview(), restoreRuns: [
    {
      id: `env-restore-${Math.random().toString(36).slice(2)}`,
      status: (installed ? "success" : "failed") as EnvironmentRestoreRun["status"],
      summary: installed ? `Installed mise to ${installPath}` : [result.stderr, result.stdout, verification.stderr, verification.stdout].join("\n").trim() || "Failed to install mise",
      createdAt: now,
    },
    ...currentOverview.restoreRuns,
  ].slice(0, 20), updatedAt: now };
  saveEnvironmentOverview(next);
  if (!installed) throw new Error([result.stderr, result.stdout, verification.stderr, verification.stdout].join("\n").trim() || "mise_install_failed");
  return next;
}

export function installEnvironmentTool(currentOverview: EnvironmentOverview, body: InstallEnvironmentToolRequest) {
  if (!body?.tool?.trim() || !body.version?.trim()) throw new Error("invalid_environment_tool");
  const now = new Date().toISOString();
  const requestedTool = body.tool.trim();
  const version = body.version.trim();
  const scope = body.scope ?? "global";
  const note = body.notes?.trim() ?? null;
  const installResult = runMiseUseGlobal(requestedTool, `${requestedTool}@${version}`);
  const detectedVersion = detectToolVersion(requestedTool);
  const status: EnvironmentToolRecord["status"] = installResult.status === 0
    ? (detectedVersion && !detectedVersion.includes(version) ? "version_mismatch" : "installed")
    : "missing";
  const record: EnvironmentToolRecord = {
    id: `env-tool-${Math.random().toString(36).slice(2)}`,
    tool: requestedTool,
    requestedVersion: version,
    detectedVersion,
    status,
    source: "mise",
    scope,
    autoRestore: body.autoRestore !== false,
    notes: note,
    createdAt: now,
    updatedAt: now,
  };
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    tools: [
      record,
      ...currentOverview.tools.filter((item) => !(item.tool === record.tool && item.scope === record.scope)),
    ],
    updatedAt: now,
  };
  saveEnvironmentOverview(next);
  if (installResult.status !== 0) throw new Error(installResult.stderr || installResult.stdout || "environment_tool_install_failed");
  return next;
}

export function registerEnvironmentTool(currentOverview: EnvironmentOverview, body: RegisterEnvironmentToolRequest) {
  if (!body?.tool?.trim() || !body.version?.trim()) throw new Error("invalid_environment_tool");
  const now = new Date().toISOString();
  const tool = body.tool.trim();
  const detectedVersion = body.detectedVersion ?? detectToolVersion(tool);
  const record: EnvironmentToolRecord = {
    id: `env-tool-${Math.random().toString(36).slice(2)}`,
    tool,
    requestedVersion: body.version.trim(),
    detectedVersion,
    status: detectedVersion
      ? (body.version.trim() && !detectedVersion.includes(body.version.trim()) ? "version_mismatch" : "installed")
      : "unknown",
    source: body.source ?? "manual",
    scope: body.scope ?? "global",
    autoRestore: body.autoRestore !== false,
    notes: body.notes?.trim() ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    tools: [
      record,
      ...currentOverview.tools.filter((item) => !(item.tool === record.tool && item.scope === record.scope)),
    ],
    updatedAt: now,
  };
  saveEnvironmentOverview(next);
  return next;
}

export function deleteEnvironmentTool(currentOverview: EnvironmentOverview, id: string) {
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    tools: currentOverview.tools.filter((item) => item.id !== id),
    updatedAt: new Date().toISOString(),
  };
  saveEnvironmentOverview(next);
  return next;
}

export function uninstallEnvironmentTool(currentOverview: EnvironmentOverview, id: string) {
  const tool = currentOverview.tools.find((item) => item.id === id) ?? null;
  if (!tool) throw new Error("environment_tool_not_found");
  if (tool.source !== "mise") throw new Error("environment_tool_uninstall_not_allowed");
  const now = new Date().toISOString();
  const target = `${tool.tool}@${tool.requestedVersion}`;
  const uninstallResult = spawnSync(getDeps().resolveMiseCommand(), ["uninstall", target], { encoding: "utf8" });
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    tools: uninstallResult.status === 0
      ? currentOverview.tools.filter((item) => item.id !== id)
      : currentOverview.tools,
    restoreRuns: [
      {
        id: `env-restore-${Math.random().toString(36).slice(2)}`,
        status: (uninstallResult.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
        summary: uninstallResult.status === 0 ? `Uninstalled ${target} via mise` : [uninstallResult.stderr, uninstallResult.stdout].join("\n").trim() || `Failed to uninstall ${target}`,
        createdAt: now,
      },
      ...currentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(next);
  if (uninstallResult.status !== 0) throw new Error(uninstallResult.stderr || uninstallResult.stdout || "environment_tool_uninstall_failed");
  return next;
}

export function setDefaultEnvironmentTool(currentOverview: EnvironmentOverview, id: string) {
  const tool = currentOverview.tools.find((item) => item.id === id) ?? null;
  if (!tool) throw new Error("environment_tool_not_found");
  const target = `${tool.tool}@${tool.requestedVersion}`;
  const result = runMiseUseGlobal(tool.tool, target);
  const now = new Date().toISOString();
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    tools: buildEnvironmentOverview().tools.map((item) => item.tool === tool.tool
      ? { ...item, isGlobalDefault: item.id === id, updatedAt: now }
      : item),
    restoreRuns: [
      {
        id: `env-restore-${Math.random().toString(36).slice(2)}`,
        status: (result.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
        summary: result.status === 0
          ? `Set ${target} as global default via mise`
          : [result.stderr, result.stdout].join("\n").trim() || `Failed to set ${target} as global default`,
        createdAt: now,
      },
      ...currentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(next);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "environment_tool_set_default_failed");
  return next;
}

export function getEnvironmentToolPackages(currentOverview: EnvironmentOverview, id: string) {
  const toolRecord = currentOverview.tools.find((item) => item.id === id) ?? null;
  if (!toolRecord) throw new Error("environment_tool_not_found");
  const recordedPackages = listPackagesForToolRecord(currentOverview, toolRecord);
  const detectedPackages = packageRegistry().scanEnvironmentPackages(toolRecord)
    .filter((item) => !recordedPackages.some((record) => record.packageName === item.packageName && record.manager === item.manager));
  const response: EnvironmentPackageDetailResponse = {
    toolRecord,
    packages: [...recordedPackages, ...detectedPackages],
    managers: packageRegistry().listEnvironmentPackageManagers(toolRecord),
    restorePreview: buildEnvironmentRestorePreview(toolRecord, recordedPackages),
  };
  return response;
}

export function listEnvironmentPackageManagers(toolRecord: EnvironmentToolRecord) {
  return packageRegistry().listEnvironmentPackageManagers(toolRecord);
}

export function inspectEnvironmentPackage(manager: string, packageName: string) {
  return packageRegistry().inspectEnvironmentPackage(manager, packageName);
}

export function recordDetectedPackages(currentOverview: EnvironmentOverview, toolRecordId: string) {
  const toolRecord = currentOverview.tools.find((item) => item.id === toolRecordId) ?? null;
  if (!toolRecord) throw new Error("environment_tool_not_found");
  const recordedPackages = listPackagesForToolRecord(currentOverview, toolRecord);
  const detectedPackages = packageRegistry().scanEnvironmentPackages(toolRecord)
    .filter((item) => !recordedPackages.some((record) => record.packageName === item.packageName && record.manager === item.manager));
  const now = new Date().toISOString();
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    packageRecords: [
      ...detectedPackages.map((pkg) => ({ ...pkg, id: `env-pkg-${Math.random().toString(36).slice(2)}`, persisted: true }) as EnvironmentPackageRecord),
      ...currentOverview.packageRecords,
    ],
    restoreRuns: [
      {
        id: `env-restore-${Math.random().toString(36).slice(2)}`,
        status: "success" as const,
        summary: `Recorded ${detectedPackages.length} detected packages for ${toolRecord.tool}@${toolRecord.requestedVersion}`,
        createdAt: now,
      },
      ...currentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(next);
  return next;
}

export function installMissingPackages(currentOverview: EnvironmentOverview, toolRecordId: string, packageIds?: string[]) {
  const toolRecord = currentOverview.tools.find((item) => item.id === toolRecordId) ?? null;
  if (!toolRecord) throw new Error("environment_tool_not_found");
  const now = new Date().toISOString();
  const packageIdSet = new Set(packageIds ?? []);
  const targets = currentOverview.packageRecords.filter((pkg) => pkg.toolRecordId === toolRecord.id && pkg.status === "missing" && (!packageIdSet.size || packageIdSet.has(pkg.id)));
  let successCount = 0;
  const updatedRecords = [...currentOverview.packageRecords];
  for (const pkg of targets) {
    const commandSpec = packageInstallCommandSpec(pkg.manager, pkg.packageName, pkg.versionSpec ?? null);
    if (!commandSpec) continue;
    const result = spawnSync(commandSpec.command, commandSpec.args, { encoding: "utf8" });
    if (result.status === 0) {
      successCount += 1;
      const index = updatedRecords.findIndex((item) => item.id === pkg.id);
        if (index >= 0) updatedRecords[index] = { ...updatedRecords[index], status: "installed" as const, persisted: true, updatedAt: now } as EnvironmentPackageRecord;
    }
  }
  const status: EnvironmentRestoreRun["status"] = successCount === targets.length ? "success" : successCount > 0 ? "partial" : "failed";
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    packageRecords: updatedRecords,
    restoreRuns: [
      {
        id: `env-restore-${Math.random().toString(36).slice(2)}`,
        status,
        summary: `Installed ${successCount}/${targets.length} missing packages for ${toolRecord.tool}@${toolRecord.requestedVersion}`,
        createdAt: now,
      },
      ...currentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(next);
  return next;
}

export function installEnvironmentPackage(currentOverview: EnvironmentOverview, body: InstallEnvironmentPackageRequest) {
  if (!body?.toolRecordId || !body.packageName?.trim() || !body.manager?.trim()) throw new Error("invalid_environment_package");
  const toolRecord = currentOverview.tools.find((item) => item.id === body.toolRecordId) ?? null;
  if (!toolRecord) throw new Error("environment_tool_not_found");
  const manager = body.manager.trim();
  const packageName = body.packageName.trim();
  const versionSpec = body.versionSpec?.trim() || null;
  const spec = versionSpec ? `${packageName}@${versionSpec}` : packageName;
  const probe = packageRegistry().inspectEnvironmentPackage(manager, packageName);
  const commandSpec = packageInstallCommandSpec(manager, packageName, versionSpec);
  if (!commandSpec) throw new Error("environment_package_manager_not_supported");
  const result = probe.installed ? { status: 0, stdout: "already installed", stderr: "" } : spawnSync(commandSpec.command, commandSpec.args, { encoding: "utf8" });
  const now = new Date().toISOString();
  const record: EnvironmentPackageRecord = {
    id: `env-pkg-${Math.random().toString(36).slice(2)}`,
    toolRecordId: toolRecord.id,
    tool: toolRecord.tool,
    runtimeVersion: toolRecord.requestedVersion,
    ecosystem: toolRecord.tool.toLowerCase(),
    manager,
    packageName,
    versionSpec,
    installedVersion: probe.version ?? versionSpec,
    installCommand: commandSpec.text,
    uninstallCommand: packageUninstallCommandText(manager, packageName),
    targetLabel: `${toolRecord.tool}@${toolRecord.requestedVersion}`,
    scope: "global",
    autoRestore: body.autoRestore !== false,
    persisted: result.status === 0,
    status: result.status === 0 ? "installed" : "failed",
    notes: body.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
  };
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    packageRecords: [
      record,
      ...currentOverview.packageRecords.filter((item) => !(item.toolRecordId === toolRecord.id && item.manager === manager && item.packageName === packageName)),
    ],
    restoreRuns: [
      {
        id: `env-restore-${Math.random().toString(36).slice(2)}`,
        status: (result.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
        summary: result.status === 0
          ? (probe.installed
            ? `Recorded existing ${packageName} for ${toolRecord.tool}@${toolRecord.requestedVersion} via ${manager}`
            : `Installed ${spec} for ${toolRecord.tool}@${toolRecord.requestedVersion} via ${manager}`)
          : [result.stderr, result.stdout].join("\n").trim() || `Failed to install ${spec}`,
        createdAt: now,
      },
      ...currentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(next);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "environment_package_install_failed");
  return next;
}

export function uninstallEnvironmentPackage(currentOverview: EnvironmentOverview, id: string, managerOverride?: string) {
  const pkg = currentOverview.packageRecords.find((item) => item.id === id) ?? null;
  if (!pkg) throw new Error("environment_package_not_found");
  const manager = managerOverride?.trim() || pkg.manager;
  const commandSpec = packageUninstallCommandSpec(manager, pkg.packageName);
  if (!commandSpec) throw new Error("environment_package_manager_not_supported");
  const result = spawnSync(commandSpec.command, commandSpec.args, { encoding: "utf8" });
  const now = new Date().toISOString();
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    packageRecords: result.status === 0
      ? currentOverview.packageRecords.filter((item) => item.id !== id)
      : currentOverview.packageRecords.map((item) => item.id === id ? ({ ...item, status: "failed" as const, updatedAt: now } as EnvironmentPackageRecord) : item),
    restoreRuns: [
      {
        id: `env-restore-${Math.random().toString(36).slice(2)}`,
        status: (result.status === 0 ? "success" : "failed") as EnvironmentRestoreRun["status"],
        summary: result.status === 0
          ? `Uninstalled ${pkg.packageName} from ${pkg.targetLabel} via ${manager}`
          : [result.stderr, result.stdout].join("\n").trim() || `Failed to uninstall ${pkg.packageName}`,
        createdAt: now,
      },
      ...currentOverview.restoreRuns,
    ].slice(0, 20),
    updatedAt: now,
  };
  saveEnvironmentOverview(next);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "environment_package_uninstall_failed");
  return next;
}

export function deleteRestoreRun(currentOverview: EnvironmentOverview, id: string) {
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    restoreRuns: currentOverview.restoreRuns.filter((item) => item.id !== id),
    updatedAt: new Date().toISOString(),
  };
  saveEnvironmentOverview(next);
  return next;
}

export function clearRestoreRuns(currentOverview: EnvironmentOverview) {
  const next: EnvironmentOverview = {
    ...buildEnvironmentOverview(),
    restoreRuns: [],
    updatedAt: new Date().toISOString(),
  };
  saveEnvironmentOverview(next);
  return next;
}
