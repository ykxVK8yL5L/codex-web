import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { statSync } from "node:fs";
import type { WebSocket } from "ws";
import type {
  CreateTerminalSessionRequest,
  SessionSummary,
  TerminalCommandRequest,
  TerminalCommandResponse,
  TerminalDefaultsResponse,
  TerminalSessionSummary,
  UpdateTerminalSessionRequest,
} from "@codex-web/protocol";

type TerminalRuntime = TerminalSessionSummary & {
  absoluteCwd: string;
  adapter: {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    onData(callback: (data: string) => void): void;
    onExit(callback: (exitCode: number | null) => void): void;
  };
  buffer: string;
  clients: Set<WebSocket>;
  ephemeral: boolean;
};

type TerminalRoutesDeps = {
  appData: { sessions: SessionSummary[] };
  createTerminalSession: (input?: CreateTerminalSessionRequest) => TerminalRuntime;
  db: Database.Database;
  deletedTerminalSessionIds: Set<string>;
  deleteTerminalSessionRecord: (sessionId: string) => void;
  listTerminalSessionSummaries: () => TerminalSessionSummary[];
  resolveTerminalCwd: (inputPath?: string) => string;
  runLoggedShellCommand: (session: SessionSummary, command: string, cwd: string, options?: { timeoutMs?: number | null; source?: string }) => Promise<TerminalCommandResponse>;
  runShellCommand: (command: string, cwd: string) => Promise<TerminalCommandResponse>;
  terminalDefaultCwd: string;
  terminalSessionFromRow: (row: Record<string, unknown>) => TerminalSessionSummary;
  terminalSessions: Map<string, TerminalRuntime>;
  terminalSummary: (session: TerminalRuntime) => TerminalSessionSummary;
  upsertTerminalSession: (session: TerminalSessionSummary) => void;
};

export function registerTerminalRoutes(app: Hono, deps: TerminalRoutesDeps) {
  app.get("/api/terminal/sessions", (c) => c.json(deps.listTerminalSessionSummaries()));

  app.get("/api/terminal/defaults", (c) => {
    const response: TerminalDefaultsResponse = { defaultCwd: deps.terminalDefaultCwd };
    return c.json(response);
  });

  app.post("/api/terminal/sessions", async (c) => {
    try {
      const body = await c.req.json<CreateTerminalSessionRequest>().catch(() => ({}));
      const session = deps.createTerminalSession(body);
      return c.json(deps.terminalSummary(session), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "terminal_session_create_failed" }, 400);
    }
  });

  app.patch("/api/terminal/sessions/:id", async (c) => {
    const body = await c.req.json<UpdateTerminalSessionRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_terminal_update" }, 400);
    const nextName = body.name?.trim();
    if (!nextName) return c.json({ error: "terminal_name_required" }, 400);
    const runtime = deps.terminalSessions.get(c.req.param("id"));
    if (runtime) {
      runtime.name = nextName;
      if (!runtime.ephemeral) deps.upsertTerminalSession(deps.terminalSummary(runtime));
      return c.json(deps.terminalSummary(runtime));
    }
    const row = deps.db.prepare("select id, name, cwd, mode, status, created_at from terminal_sessions where id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!row) return c.json({ error: "terminal_session_not_found" }, 404);
    const session = deps.terminalSessionFromRow(row);
    session.name = nextName;
    deps.upsertTerminalSession(session);
    return c.json(session);
  });

  app.delete("/api/terminal/sessions/:id", (c) => {
    const session = deps.terminalSessions.get(c.req.param("id"));
    if (!session) {
      deps.deleteTerminalSessionRecord(c.req.param("id"));
      return c.json({ ok: true });
    }
    deps.deletedTerminalSessionIds.add(session.id);
    session.adapter.kill();
    deps.terminalSessions.delete(session.id);
    deps.deleteTerminalSessionRecord(session.id);
    for (const client of session.clients) client.close(1000, "session_deleted");
    return c.json({ ok: true });
  });

  app.post("/api/terminal/exec", async (c) => {
    try {
      const body = await c.req.json<TerminalCommandRequest>().catch(() => null);
      if (!body?.command?.trim()) return c.json({ error: "command_required" }, 400);
      const cwd = deps.resolveTerminalCwd(body.cwd);
      if (!statSync(cwd).isDirectory()) return c.json({ error: "cwd_not_directory" }, 400);
      const session = body.sessionId ? deps.appData.sessions.find((item) => item.id === body.sessionId) : null;
      if (session) return c.json(await deps.runLoggedShellCommand(session, body.command, cwd, { source: "terminal-exec" }));
      return c.json(await deps.runShellCommand(body.command, cwd));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "command_failed" }, 400);
    }
  });
}
