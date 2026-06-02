import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type {
  EnvironmentPackageManagerOption,
  EnvironmentPackageRecord,
  EnvironmentToolRecord,
} from "@codex-web/protocol";

type PackageInspectResult = { installed: boolean; version: string | null };

type PackageHandler = {
  managerId: string;
  label: string;
  installExample: string;
  uninstallExample: string;
  version: () => string | null;
  inspect?: (packageName: string) => PackageInspectResult;
  scan?: (toolRecord: EnvironmentToolRecord) => EnvironmentPackageRecord[];
};

type ToolPackageRuntime = {
  managers: PackageHandler[];
};

function packageListInspector(args: string[], predicate: (line: string, packageName: string) => string | null) {
  return (packageName: string) => {
    const match = installedPackageLines("mise", args).find((line) => predicate(line, packageName) !== null);
    return { installed: Boolean(match), version: match ? predicate(match, packageName) : null };
  };
}

function packageListScanner(
  manager: string,
  args: string[],
  mapLine: (line: string) => { packageName: string; version?: string | null; versionSpec?: string | null } | null,
  commandVersionArgs?: { packageName: string; versionSpec?: string | null },
  options?: { sliceStart?: number },
) {
  return (toolRecord: EnvironmentToolRecord) => installedPackageLines("mise", args)
    .slice(options?.sliceStart ?? 0)
    .flatMap((line) => {
      const parsed = mapLine(line);
      if (!parsed) return [];
      const commandPackageName = commandVersionArgs?.packageName ?? parsed.packageName;
      const commandVersionSpec = commandVersionArgs?.versionSpec ?? parsed.versionSpec ?? parsed.version ?? null;
      return [detectedEnvironmentPackageRecord(toolRecord, manager, parsed.packageName, parsed.version ?? null, commandVersionSpec, commandPackageName)];
    });
}

function installedPackageLines(command: string, args: string[]) {
  const result = spawnSync(command === "mise" ? resolveMiseCommand() : command, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function miseCommandCandidates() {
  const home = process.env.HOME;
  return [
    process.env.MISE_BIN,
    process.env.MISE_PATH,
    "mise",
    home ? join(home, ".local/bin/mise") : null,
    home ? join(home, ".mise/bin/mise") : null,
    "/usr/local/bin/mise",
    "/opt/homebrew/bin/mise",
    "/usr/bin/mise",
  ].filter((item): item is string => Boolean(item));
}

function resolveMiseCommand() {
  for (const candidate of miseCommandCandidates()) {
    try {
      const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      if (result.status === 0) return candidate;
    } catch {}
  }
  return "mise";
}

export function packageInstallCommandArgs(manager: string, packageName: string, versionSpec?: string | null) {
  const spec = versionSpec?.trim() ? `${packageName}@${versionSpec.trim()}` : packageName;
  if (manager === "uv") return ["exec", "--", "uv", "tool", "install", spec];
  if (manager === "pip") return ["exec", "--", "python3", "-m", "pip", "install", spec];
  if (manager === "bun") return ["exec", "--", "bun", "add", "-g", spec];
  if (manager === "go-install") return ["exec", "--", "go", "install", versionSpec?.trim() ? spec : `${packageName}@latest`];
  if (manager === "cargo") return ["exec", "--", "cargo", "install", packageName];
  if (manager === "gem") return ["exec", "--", "gem", "install", spec];
  if (manager === "composer") return ["exec", "--", "composer", "global", "require", spec];
  if (manager === "pnpm") return ["exec", "--", "pnpm", "add", "-g", spec];
  if (manager === "npm") return ["exec", "--", "npm", "install", "-g", spec];
  return null;
}

export function packageUninstallCommandArgs(manager: string, packageName: string) {
  if (manager === "uv") return ["exec", "--", "uv", "tool", "uninstall", packageName];
  if (manager === "pip") return ["exec", "--", "python3", "-m", "pip", "uninstall", "-y", packageName];
  if (manager === "bun") return ["exec", "--", "bun", "remove", "-g", packageName];
  if (manager === "cargo") return ["exec", "--", "cargo", "uninstall", packageName];
  if (manager === "gem") return ["exec", "--", "gem", "uninstall", packageName, "-a", "-x", "-I"];
  if (manager === "composer") return ["exec", "--", "composer", "global", "remove", packageName];
  if (manager === "pnpm") return ["exec", "--", "pnpm", "remove", "-g", packageName];
  if (manager === "npm") return ["exec", "--", "npm", "uninstall", "-g", packageName];
  return null;
}

export function packageUninstallCommandText(manager: string, packageName: string) {
  if (manager === "go-install") return `Remove ${packageName} from GOPATH/bin manually`;
  if (manager === "shards") return "Manual cleanup required";
  const args = packageUninstallCommandArgs(manager, packageName);
  return args ? `mise ${args.join(" ")}` : null;
}

function detectedEnvironmentPackageRecord(
  toolRecord: EnvironmentToolRecord,
  manager: string,
  packageName: string,
  installedVersion: string | null,
  versionSpec: string | null = installedVersion,
  commandPackageName = packageName,
) {
  const commandArgs = packageInstallCommandArgs(manager, commandPackageName, null) ?? ["exec", "--", manager, "install", commandPackageName];
  return {
    id: `detected-${toolRecord.id}-${manager}-${packageName}`,
    toolRecordId: toolRecord.id,
    tool: toolRecord.tool,
    runtimeVersion: toolRecord.requestedVersion,
    ecosystem: toolRecord.tool.toLowerCase(),
    manager,
    packageName,
    installedVersion,
    versionSpec,
    installCommand: `mise ${commandArgs.join(" ")}`,
    uninstallCommand: packageUninstallCommandText(manager, packageName),
    targetLabel: `${toolRecord.tool}@${toolRecord.requestedVersion}`,
    scope: "global" as const,
    autoRestore: true,
    persisted: false,
    status: "installed" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies EnvironmentPackageRecord;
}

function packageRuntimeKey(tool: string) {
  return tool.trim().toLowerCase();
}

export function createEnvironmentPackageRegistry(commandVersion: (command: string, args: string[]) => string | null) {
  const environmentPackageRuntimes: Record<string, ToolPackageRuntime> = {
    python: {
      managers: [
        {
          managerId: "pip",
          label: "pip",
          installExample: "python3 -m pip install <package>",
          uninstallExample: "python3 -m pip uninstall <package>",
          version: () => commandVersion("python3", ["-m", "pip", "--version"]) ?? commandVersion("python", ["-m", "pip", "--version"]),
          inspect: (pkg) => {
            const result = spawnSync(resolveMiseCommand(), ["exec", "--", "python3", "-m", "pip", "show", pkg], { encoding: "utf8" });
            if (result.status !== 0) return { installed: false, version: null };
            const version = result.stdout.split(/\r?\n/).find((line) => line.startsWith("Version:"))?.replace("Version:", "").trim() ?? null;
            return { installed: Boolean(version), version };
          },
          scan: (toolRecord) => {
            const result = spawnSync(resolveMiseCommand(), ["exec", "--", "python3", "-m", "pip", "list", "--format", "json"], { encoding: "utf8" });
            const output = [result.stdout, result.stderr].join("\n").trim();
            if (result.status !== 0 || !output) return [];
            const parsed = JSON.parse(output) as Array<{ name: string; version?: string }>;
            return parsed.map((item) => detectedEnvironmentPackageRecord(toolRecord, "pip", item.name, item.version ?? null));
          },
        },
        {
          managerId: "uv",
          label: "uv tool",
          installExample: "uv tool install <package>",
          uninstallExample: "uv tool uninstall <package>",
          version: () => commandVersion("uv", ["--version"]),
          inspect: packageListInspector(["exec", "--", "uv", "tool", "list"], (line, packageName) => line.toLowerCase().startsWith(`${packageName.toLowerCase()} `) ? line.split(/\s+/)[1] ?? null : null),
        },
      ],
    },
    node: {
      managers: [
        {
          managerId: "pnpm",
          label: "pnpm",
          installExample: "pnpm add -g <package>",
          uninstallExample: "pnpm remove -g <package>",
          version: () => commandVersion("pnpm", ["--version"]),
          inspect: (pkg) => {
            const result = spawnSync(resolveMiseCommand(), ["exec", "--", "pnpm", "list", "-g", pkg, "--depth", "0", "--json"], { encoding: "utf8" });
            const output = [result.stdout, result.stderr].join("\n").trim();
            if (result.status !== 0 || !output) return { installed: false, version: null };
            const parsed = JSON.parse(output) as Array<{ dependencies?: Record<string, { version?: string }> }>;
            const version = parsed[0]?.dependencies?.[pkg]?.version ?? null;
            return { installed: Boolean(version), version };
          },
          scan: (toolRecord) => {
            const result = spawnSync(resolveMiseCommand(), ["exec", "--", "pnpm", "list", "-g", "--depth", "0", "--json"], { encoding: "utf8" });
            const output = [result.stdout, result.stderr].join("\n").trim();
            if (result.status !== 0 || !output) return [];
            const parsed = JSON.parse(output) as Array<{ dependencies?: Record<string, { version?: string }> }>;
            return Object.entries(parsed[0]?.dependencies ?? {}).map(([packageName, value]) => detectedEnvironmentPackageRecord(toolRecord, "pnpm", packageName, value.version ?? null));
          },
        },
        {
          managerId: "npm",
          label: "npm",
          installExample: "npm install -g <package>",
          uninstallExample: "npm uninstall -g <package>",
          version: () => commandVersion("npm", ["--version"]),
          inspect: (pkg) => {
            const result = spawnSync(resolveMiseCommand(), ["exec", "--", "npm", "list", "-g", pkg, "--depth", "0", "--json"], { encoding: "utf8" });
            const output = [result.stdout, result.stderr].join("\n").trim();
            if (!output) return { installed: false, version: null };
            const parsed = JSON.parse(output) as { dependencies?: Record<string, { version?: string }> };
            const version = parsed.dependencies?.[pkg]?.version ?? null;
            return { installed: Boolean(version), version };
          },
        },
      ],
    },
    bun: {
      managers: [{
        managerId: "bun",
        label: "bun",
        installExample: "bun add -g <package>",
        uninstallExample: "bun remove -g <package>",
        version: () => commandVersion("bun", ["--version"]),
        inspect: packageListInspector(["exec", "--", "bun", "pm", "ls", "-g"], (line, packageName) => line.toLowerCase().startsWith(`${packageName.toLowerCase()}@`) ? line.split("@")[1] ?? null : null),
        scan: packageListScanner("bun", ["exec", "--", "bun", "pm", "ls", "-g"], (line) => {
          if (!line.includes("@")) return null;
          const at = line.lastIndexOf("@");
          return { packageName: line.slice(0, at), version: line.slice(at + 1) };
        }),
      }],
    },
    go: {
      managers: [{ managerId: "go-install", label: "go install", installExample: "go install <package>@latest", uninstallExample: "rm <go-bin>/<package>", version: () => commandVersion("go", ["version"]) }],
    },
    rust: {
      managers: [{
        managerId: "cargo",
        label: "cargo",
        installExample: "cargo install <package>",
        uninstallExample: "cargo uninstall <package>",
        version: () => commandVersion("cargo", ["--version"]),
        inspect: packageListInspector(["exec", "--", "cargo", "install", "--list"], (line, packageName) => line.toLowerCase().startsWith(`${packageName.toLowerCase()} `) ? line.match(/\bv([0-9][^\s]*)/)?.[1] ?? null : null),
        scan: packageListScanner("cargo", ["exec", "--", "cargo", "install", "--list"], (line) => {
          if (!line.includes(" v")) return null;
          const packageName = line.split(/\s+/)[0]?.trim() ?? "";
          return packageName ? { packageName, version: line.match(/\bv([0-9][^\s]*)/)?.[1] ?? null } : null;
        }),
      }],
    },
    ruby: {
      managers: [{
        managerId: "gem",
        label: "gem",
        installExample: "gem install <package>",
        uninstallExample: "gem uninstall <package>",
        version: () => commandVersion("gem", ["--version"]),
        inspect: (pkg) => {
          const match = installedPackageLines("mise", ["exec", "--", "gem", "list", pkg]).find((line) => line.toLowerCase().startsWith(pkg.toLowerCase()));
          return { installed: Boolean(match), version: match?.match(/\(([^)]+)\)/)?.[1]?.split(",")[0]?.trim() ?? null };
        },
        scan: packageListScanner("gem", ["exec", "--", "gem", "list", "--local"], (line) => {
          if (line.startsWith("***")) return null;
          const packageName = line.split(/\s+/)[0]?.trim() ?? "";
          return packageName ? { packageName, version: line.match(/\(([^)]+)\)/)?.[1]?.split(",")[0]?.trim() ?? null } : null;
        }),
      }],
    },
    php: {
      managers: [{
        managerId: "composer",
        label: "composer",
        installExample: "composer global require <package>",
        uninstallExample: "composer global remove <package>",
        version: () => commandVersion("composer", ["--version"]),
        inspect: (pkg) => {
          const match = installedPackageLines("mise", ["exec", "--", "composer", "global", "show", pkg]).find((line) => line.toLowerCase().startsWith(pkg.toLowerCase()));
          return { installed: Boolean(match), version: match?.split(/\s+/)[1] ?? null };
        },
        scan: packageListScanner("composer", ["exec", "--", "composer", "global", "show", "--name-only"], (line) => line ? { packageName: line, version: null, versionSpec: null } : null),
      }],
    },
    deno: {
      managers: [{
        managerId: "deno",
        label: "deno",
        installExample: "deno install --global -A <package>",
        uninstallExample: "deno uninstall <package>",
        version: () => commandVersion("deno", ["--version"]),
        inspect: () => {
          const result = spawnSync(resolveMiseCommand(), ["exec", "--", "deno", "uninstall", "--help"], { encoding: "utf8" });
          return { installed: result.status === 0, version: null };
        },
      }],
    },
    dotnet: {
      managers: [{
        managerId: "dotnet-tool",
        label: "dotnet tool",
        installExample: "dotnet tool install -g <package>",
        uninstallExample: "dotnet tool uninstall -g <package>",
        version: () => commandVersion("dotnet", ["--version"]),
        inspect: packageListInspector(["exec", "--", "dotnet", "tool", "list", "-g"], (line, packageName) => line.toLowerCase().startsWith(packageName.toLowerCase()) ? line.split(/\s+/)[1] ?? null : null),
        scan: packageListScanner("dotnet-tool", ["exec", "--", "dotnet", "tool", "list", "-g"], (line) => {
          const fields = line.split(/\s+/);
          const packageName = fields[0] ?? "";
          return packageName ? { packageName, version: fields[1] ?? null } : null;
        }, undefined, { sliceStart: 2 }),
      }],
    },
    elixir: {
      managers: [{
        managerId: "mix-archive",
        label: "mix archive",
        installExample: "mix archive.install hex <package> --force",
        uninstallExample: "mix archive.uninstall <package>",
        version: () => commandVersion("mix", ["--version"]),
        inspect: packageListInspector(["exec", "--", "mix", "archive"], (line, packageName) => line.toLowerCase().includes(packageName.toLowerCase()) ? "" : null),
      }],
    },
    erlang: {
      managers: [{
        managerId: "mix-archive",
        label: "mix archive",
        installExample: "mix archive.install hex <package> --force",
        uninstallExample: "mix archive.uninstall <package>",
        version: () => commandVersion("mix", ["--version"]),
        inspect: packageListInspector(["exec", "--", "mix", "archive"], (line, packageName) => line.toLowerCase().includes(packageName.toLowerCase()) ? "" : null),
      }],
    },
    nim: {
      managers: [{
        managerId: "nimble",
        label: "nimble",
        installExample: "nimble install -y <package>",
        uninstallExample: "nimble uninstall -y <package>",
        version: () => commandVersion("nimble", ["--version"]),
        inspect: packageListInspector(["exec", "--", "nimble", "list", "-i"], (line, packageName) => line.toLowerCase().startsWith(packageName.toLowerCase()) ? "" : null),
        scan: packageListScanner("nimble", ["exec", "--", "nimble", "list", "-i"], (line) => {
          if (!line.includes("[")) return null;
          const packageName = line.split(/\s+/)[0] ?? "";
          return packageName ? { packageName, version: null, versionSpec: null } : null;
        }),
      }],
    },
    dart: {
      managers: [{
        managerId: "dart-pub",
        label: "dart pub",
        installExample: "dart pub global activate <package>",
        uninstallExample: "dart pub global deactivate <package>",
        version: () => commandVersion("dart", ["--version"]),
        inspect: packageListInspector(["exec", "--", "dart", "pub", "global", "list"], (line, packageName) => line.toLowerCase().startsWith(packageName.toLowerCase()) ? "" : null),
        scan: packageListScanner("dart-pub", ["exec", "--", "dart", "pub", "global", "list"], (line) => {
          const packageName = line.split(/\s+/)[0] ?? "";
          return packageName ? { packageName, version: null, versionSpec: null } : null;
        }),
      }],
    },
    flutter: {
      managers: [{
        managerId: "dart-pub",
        label: "dart pub",
        installExample: "dart pub global activate <package>",
        uninstallExample: "dart pub global deactivate <package>",
        version: () => commandVersion("dart", ["--version"]),
        inspect: packageListInspector(["exec", "--", "dart", "pub", "global", "list"], (line, packageName) => line.toLowerCase().startsWith(packageName.toLowerCase()) ? "" : null),
        scan: packageListScanner("dart-pub", ["exec", "--", "dart", "pub", "global", "list"], (line) => {
          const packageName = line.split(/\s+/)[0] ?? "";
          return packageName ? { packageName, version: null, versionSpec: null } : null;
        }),
      }],
    },
    lua: {
      managers: [{
        managerId: "luarocks",
        label: "luarocks",
        installExample: "luarocks install <package>",
        uninstallExample: "luarocks remove <package>",
        version: () => commandVersion("luarocks", ["--version"]),
        inspect: packageListInspector(["exec", "--", "luarocks", "list"], (line, packageName) => line.toLowerCase().startsWith(packageName.toLowerCase()) ? "" : null),
        scan: packageListScanner("luarocks", ["exec", "--", "luarocks", "list"], (line) => {
          if (line.startsWith("Rocks") || line.startsWith("--")) return null;
          const packageName = line.split(/\s+/)[0] ?? "";
          return packageName ? { packageName, version: null, versionSpec: null } : null;
        }),
      }],
    },
    perl: {
      managers: [{ managerId: "cpanm", label: "cpanm", installExample: "cpanm <package>", uninstallExample: "cpanm --uninstall <package>", version: () => commandVersion("cpanm", ["--version"]) }],
    },
    crystal: {
      managers: [{ managerId: "shards", label: "shards", installExample: "shards install <package>", uninstallExample: "rm -rf <shard>", version: () => commandVersion("shards", ["--version"]) }],
    },
  };

  function packageRuntime(tool: string) {
    return environmentPackageRuntimes[packageRuntimeKey(tool)] ?? null;
  }

  function packageHandlerForManager(manager: string) {
    for (const runtime of Object.values(environmentPackageRuntimes)) {
      const found = runtime.managers.find((item) => item.managerId === manager);
      if (found) return found;
    }
    return null;
  }

  return {
    packageManagerVersion(manager: string) {
      return packageHandlerForManager(manager)?.version() ?? null;
    },
    listEnvironmentPackageManagers(toolRecord: EnvironmentToolRecord): EnvironmentPackageManagerOption[] {
      return packageRuntime(toolRecord.tool)?.managers.map((manager) => ({
        id: manager.managerId,
        label: manager.label,
        installCommandExample: manager.installExample,
        uninstallCommandExample: manager.uninstallExample,
        supported: true,
        detectedVersion: manager.version(),
      })) ?? [];
    },
    inspectEnvironmentPackage(manager: string, packageName: string): PackageInspectResult {
      const pkg = packageName.trim();
      if (!pkg) return { installed: false, version: null };
      try {
        return packageHandlerForManager(manager)?.inspect?.(pkg) ?? { installed: false, version: null };
      } catch {
        return { installed: false, version: null };
      }
    },
    scanEnvironmentPackages(toolRecord: EnvironmentToolRecord) {
      try {
        return packageRuntime(toolRecord.tool)?.managers.flatMap((manager) => manager.scan?.(toolRecord) ?? []) ?? [];
      } catch {
        return [];
      }
    },
  };
}
