import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function append(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, value, "utf8");
}

process.on("message", (payload) => {
  if (!payload || typeof payload !== "object") process.exit(1);
  const { command, args, cwd, logPath, metaPath } = payload;
  if (!command || !Array.isArray(args) || !cwd || !logPath || !metaPath) process.exit(1);
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  writeJson(metaPath, {
    runnerPid: process.pid,
    childPid: child.pid ?? null,
    running: true,
    exitCode: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  child.stdout?.on("data", (chunk) => append(logPath, chunk.toString("utf8")));
  child.stderr?.on("data", (chunk) => append(logPath, chunk.toString("utf8")));
  child.on("error", (error) => {
    append(logPath, `\n[task spawn error] ${error.message}\n`);
    writeJson(metaPath, {
      runnerPid: process.pid,
      childPid: child.pid ?? null,
      running: false,
      exitCode: null,
      error: error.message,
      updatedAt: new Date().toISOString(),
    });
    process.exit(1);
  });
  child.on("close", (exitCode) => {
    writeJson(metaPath, {
      runnerPid: process.pid,
      childPid: child.pid ?? null,
      running: false,
      exitCode,
      updatedAt: new Date().toISOString(),
    });
    process.exit(exitCode ?? 1);
  });
  const stop = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.disconnect?.();
});
