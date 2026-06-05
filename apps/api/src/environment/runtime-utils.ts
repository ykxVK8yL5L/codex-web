import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";

export function commandVersion(command: string, args: string[]) {
  try {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0) return null;
    return [result.stdout, result.stderr].join("\n").trim().split(/\r?\n/)[0] || "installed";
  } catch {
    return null;
  }
}

export function miseExecVersion(command: string, args: string[]) {
  try {
    const result = spawnSync(resolveMiseCommand(), ["exec", "--", command, ...args], { encoding: "utf8" });
    if (result.status !== 0) return null;
    return [result.stdout, result.stderr].join("\n").trim().split(/\r?\n/)[0] || "installed";
  } catch {
    return null;
  }
}

export function miseCommandCandidates() {
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

export function resolveMiseCommand() {
  for (const candidate of miseCommandCandidates()) {
    try {
      const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      if (result.status === 0) return candidate;
    } catch {}
  }
  return "mise";
}

export function managedChildEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = process.env.HOME;
  const additions = [
    process.env.MISE_SHIMS_DIR,
    home ? join(home, ".local/share/mise/shims") : null,
    home ? join(home, ".mise/shims") : null,
    home ? join(home, ".local/bin") : null,
    home ? join(home, ".mise/bin") : null,
    "/usr/local/bin",
  ].filter((item): item is string => Boolean(item));
  const currentPath = process.env.PATH ?? "";
  const currentParts = currentPath.split(delimiter).filter(Boolean);
  const nextPath = [
    ...additions.filter((item) => !currentParts.includes(item)),
    ...currentParts,
  ].join(delimiter);
  return {
    ...process.env,
    PATH: nextPath,
    ...extra,
  };
}


