import { spawn as spawnProcess, type ChildProcess } from "node:child_process";
import type { TerminalCommandResponse } from "@codex-web/protocol";

type TerminalCommandRuntimeDeps = {
  managedChildEnv: () => NodeJS.ProcessEnv;
  toTerminalPath: (absolutePath: string) => string;
};

export function createTerminalCommandRuntime(deps: TerminalCommandRuntimeDeps) {
  const { managedChildEnv, toTerminalPath } = deps;

function runShellCommand(command: string, cwd: string, options: { timeoutMs?: number | null; onChild?: (child: ChildProcess) => void } = {}): Promise<TerminalCommandResponse> {
  const startedAt = Date.now();
  return new Promise((resolveCommand) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawnProcess("/bin/zsh", ["-lc", command], { cwd, env: managedChildEnv() });
    options.onChild?.(child);
    const trimOutput = (value: string) => value.slice(-64 * 1024);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = trimOutput(stdout + chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = trimOutput(stderr + chunk.toString("utf8"));
    });
    const timeoutMs = options.timeoutMs === undefined ? 30_000 : options.timeoutMs;
    const timeout = timeoutMs === null ? null : setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("close", (exitCode) => {
      if (timeout) clearTimeout(timeout);
      resolveCommand({ command, cwd: toTerminalPath(cwd), exitCode, stdout, stderr, durationMs: Date.now() - startedAt, timedOut });
    });
  });
}

function formatShellCommandOutput(result: TerminalCommandResponse, timeoutSeconds?: number | null) {
  return [
    `Command: ${result.command}`,
    `CWD: ${result.cwd}`,
    `Exit code: ${result.exitCode ?? "null"}`,
    `Duration: ${result.durationMs}ms${result.timedOut && timeoutSeconds ? ` (timed out after ${timeoutSeconds}s)` : ""}`,
    "",
    "stdout:",
    result.stdout || "(empty)",
    "",
    "stderr:",
    result.stderr || "(empty)",
  ].join("\n");
}



  return { formatShellCommandOutput, runShellCommand };
}
