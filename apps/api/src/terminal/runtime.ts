import type Database from "better-sqlite3";
import { spawn as spawnProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { WebSocket } from "ws";
import { spawn as spawnPty } from "node-pty";
import type { CreateTerminalSessionRequest, TerminalSessionSummary } from "@codex-web/protocol";

type TerminalAdapter = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitCode: number | null) => void): void;
};

export type TerminalRuntime = TerminalSessionSummary & {
  absoluteCwd: string;
  adapter: TerminalAdapter;
  buffer: string;
  clients: Set<WebSocket>;
  ephemeral: boolean;
};

type CreateTerminalSessionInput = CreateTerminalSessionRequest & { ephemeral?: boolean };

type TerminalRuntimeDeps = {
  db: Database.Database;
  managedChildEnv: (extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  resolveTerminalCwd: (inputPath?: string) => string;
  toTerminalPath: (absolutePath: string) => string;
};

export function createTerminalRuntime(deps: TerminalRuntimeDeps) {
  const { db, managedChildEnv, resolveTerminalCwd, toTerminalPath } = deps;
  const terminalSessions = new Map<string, TerminalRuntime>();
  const deletedTerminalSessionIds = new Set<string>();

function terminalSessionFromRow(row: Record<string, unknown>): TerminalSessionSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    cwd: String(row.cwd),
    mode: row.mode === "pipe" ? "pipe" : "pty",
    status: row.status === "running" ? "running" : "closed",
    createdAt: String(row.created_at),
  };
}

function listTerminalSessionSummaries() {
  const persisted = (db.prepare(`
    select id, name, cwd, mode, status, created_at
    from terminal_sessions
    order by updated_at desc, created_at desc
  `).all() as Array<Record<string, unknown>>).map(terminalSessionFromRow);
  const runtimeIds = new Set(terminalSessions.keys());
  const runtimeSessions = Array.from(terminalSessions.values()).filter((session) => !session.ephemeral).map(terminalSummary);
  return [
    ...runtimeSessions,
    ...persisted.filter((session) => !runtimeIds.has(session.id)),
  ];
}

function upsertTerminalSession(session: TerminalSessionSummary) {
  db.prepare(`
    insert into terminal_sessions (id, name, cwd, mode, status, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      cwd = excluded.cwd,
      mode = excluded.mode,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(session.id, session.name, session.cwd, session.mode, session.status, session.createdAt, new Date().toISOString());
}

function markTerminalClosed(sessionId: string) {
  db.prepare("update terminal_sessions set status = 'closed', updated_at = ? where id = ?").run(new Date().toISOString(), sessionId);
}

function deleteTerminalSessionRecord(sessionId: string) {
  db.prepare("delete from terminal_sessions where id = ?").run(sessionId);
}

function closePersistedRunningTerminals() {
  db.prepare("update terminal_sessions set status = 'closed', updated_at = ? where status = 'running'").run(new Date().toISOString());
}


function createPipeTerminalAdapter(cwd: string, shellPath: string, warning: string | null) {
  const child = spawnProcess(shellPath, ["-i"], { cwd, env: managedChildEnv() });
  return {
    mode: "pipe" as const,
    warning,
    adapter: {
      write: (data: string) => child.stdin?.write(data.replaceAll("\r", "\n")),
      resize: () => undefined,
      kill: () => child.kill(),
      onData: (callback: (value: string) => void) => {
        child.stdout?.on("data", (chunk: Buffer) => callback(chunk.toString("utf8")));
        child.stderr?.on("data", (chunk: Buffer) => callback(chunk.toString("utf8")));
      },
      onExit: (callback: (exitCode: number | null) => void) => {
        child.on("error", () => callback(1));
        child.on("close", (exitCode) => callback(exitCode));
      },
    },
  };
}

function createScriptTerminalAdapter(cwd: string, shellPath: string) {
  const child = spawnProcess("script", ["-q", "/dev/null", shellPath, "-l"], { cwd, env: managedChildEnv() });
  return {
    mode: "pty" as const,
    warning: null,
    adapter: {
      write: (data: string) => child.stdin?.write(data),
      resize: (cols: number, rows: number) => {
        child.stdin?.write(`stty rows ${rows} cols ${cols}\n`);
      },
      kill: () => child.kill(),
      onData: (callback: (value: string) => void) => {
        child.stdout?.on("data", (chunk: Buffer) => callback(chunk.toString("utf8")));
        child.stderr?.on("data", (chunk: Buffer) => callback(chunk.toString("utf8")));
      },
      onExit: (callback: (exitCode: number | null) => void) => {
        child.on("error", () => callback(1));
        child.on("close", (exitCode) => callback(exitCode));
      },
    },
  };
}

function createTerminalAdapter(cwd: string): { adapter: TerminalAdapter; mode: "pty" | "pipe"; warning: string | null } {
  const shellPath = resolveShellPath();
  try {
    const shell = spawnPty(shellPath, ["-l"], { name: "xterm-256color", cols: 100, rows: 30, cwd, env: managedChildEnv() });
    return {
      mode: "pty",
      warning: null,
      adapter: {
        write: (data) => shell.write(data),
        resize: (cols, rows) => shell.resize(cols, rows),
        kill: () => shell.kill(),
        onData: (callback) => shell.onData(callback),
        onExit: (callback) => shell.onExit(({ exitCode }) => callback(exitCode)),
      },
    };
  } catch (error) {
    try {
      return createScriptTerminalAdapter(cwd, shellPath);
    } catch (scriptError) {
      return createPipeTerminalAdapter(
        cwd,
        shellPath,
        error instanceof Error
          ? `PTY fallback: ${error.message}${scriptError instanceof Error ? `; script fallback failed: ${scriptError.message}` : ""}`
          : "PTY fallback active",
      );
    }
  }
}

function resolveShellPath() {
  const candidates = [
    process.env.SHELL,
    "/bin/zsh",
    "/usr/bin/zsh",
    "/bin/bash",
    "/usr/bin/bash",
    "/bin/sh",
    "/usr/bin/sh",
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("shell_not_found");
}

function terminalSummary(session: TerminalRuntime): TerminalSessionSummary {
  return {
    id: session.id,
    name: session.name,
    cwd: session.cwd,
    mode: session.mode,
    status: session.status,
    createdAt: session.createdAt,
  };
}

function uniqueTerminalSessionName(preferredName?: string) {
  const existingNames = new Set(listTerminalSessionSummaries().map((session) => session.name));
  const preferred = preferredName?.trim();
  if (preferred && !existingNames.has(preferred)) return preferred;
  if (!preferred || /^shell(?: \d+)?$/.test(preferred)) {
    let shellIndex = 1;
    while (existingNames.has(`shell ${shellIndex}`)) shellIndex += 1;
    return `shell ${shellIndex}`;
  }
  const baseName = preferred;
  let index = 2;
  while (existingNames.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function createTerminalSession(input: CreateTerminalSessionInput = {}) {
  const absoluteCwd = resolveTerminalCwd(input.cwd);
  if (!statSync(absoluteCwd).isDirectory()) throw new Error("cwd_not_directory");
  const { adapter, mode, warning } = createTerminalAdapter(absoluteCwd);
  const session: TerminalRuntime = {
    id: randomUUID(),
    name: uniqueTerminalSessionName(input.name),
    cwd: toTerminalPath(absoluteCwd),
    absoluteCwd,
    mode,
    status: "running",
    createdAt: new Date().toISOString(),
    adapter,
    buffer: "",
    clients: new Set(),
    ephemeral: Boolean(input.ephemeral),
  };
  terminalSessions.set(session.id, session);
  if (!session.ephemeral) upsertTerminalSession(terminalSummary(session));
  const append = (data: string) => {
    session.buffer = (session.buffer + data).slice(-120 * 1024);
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "output", data }));
    }
  };
  if (warning) append(`[warning: ${warning}]\r\n`);
  adapter.onData(append);
  adapter.onExit((exitCode) => {
    session.status = "closed";
    if (!session.ephemeral && !deletedTerminalSessionIds.has(session.id)) upsertTerminalSession(terminalSummary(session));
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "exit", exitCode }));
    }
    terminalSessions.delete(session.id);
  });
  return session;
}



  return {
    closePersistedRunningTerminals,
    createTerminalSession,
    deletedTerminalSessionIds,
    deleteTerminalSessionRecord,
    listTerminalSessionSummaries,
    markTerminalClosed,
    resolveShellPath,
    terminalSessionFromRow,
    terminalSessions,
    terminalSummary,
    upsertTerminalSession,
  };
}
