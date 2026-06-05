import React, { useEffect, useRef, useState } from "react";
import { History, Pencil, Play, Square, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useAppDialog } from "@/components/AppDialog";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import type { TranslationKey } from "@/lib/i18n";
import type { CreateTerminalSessionRequest, TerminalDefaultsResponse, TerminalSessionSummary, UpdateTerminalSessionRequest } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;

export function TerminalPage({
  sessionToken,
  t,
  initialCwd,
  embedded = false,
  onOpenMainNav,
}: {
  sessionToken: string;
  t: TFunction;
  initialCwd?: string;
  embedded?: boolean;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog();
  function requestedTerminalCwdFromHash() {
    const [, query = ""] = window.location.hash.split("?");
    return new URLSearchParams(query).get("cwd");
  }

  const requestedCwd = initialCwd ?? requestedTerminalCwdFromHash();
  const [cwd, setCwd] = useState(requestedCwd ?? "~");
  const [connected, setConnected] = useState(false);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState("");
  const [terminalSearch, setTerminalSearch] = useState("");
  const [terminalStatusFilter, setTerminalStatusFilter] = useState("");
  const [terminalSessionsPanelOpen, setTerminalSessionsPanelOpen] = useState(false);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalModeRef = useRef<"pty" | "pipe">("pty");
  const activeTerminalSession = terminalSessions.find((item) => item.id === activeTerminalId);
  const visibleTerminalSessions = terminalSessions.filter((session) => {
    const query = terminalSearch.trim().toLowerCase();
    if (terminalStatusFilter && session.status !== terminalStatusFilter) return false;
    return !query || [session.name, session.cwd, session.mode, session.status].some((value) => value.toLowerCase().includes(query));
  });

  async function getTerminalDefaultCwd() {
    if (requestedCwd) return requestedCwd;
    const response = await fetch("/api/terminal/defaults", {
      headers: { authorization: `Bearer ${sessionToken}` },
    }).catch(() => null);
    if (!response?.ok) return "~";
    const defaults = (await response.json().catch(() => null)) as TerminalDefaultsResponse | null;
    return defaults?.defaultCwd || "~";
  }

  useEffect(() => {
    if (!terminalHostRef.current) return;
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "SFMono-Regular, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: "#111511",
        foreground: "#d9e7dc",
        cursor: "#d9e7dc",
        selectionBackground: "#315f9f66",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();
    terminal.onData((data) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        if (terminalModeRef.current === "pipe") {
          terminal.write(data === "\r" ? "\r\n" : data);
        }
        socketRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      sendTerminalSize();
    });
    resizeObserver.observe(terminalHostRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    void (async () => {
      const anonymousCwd = await getTerminalDefaultCwd();
      setCwd(anonymousCwd);
      connectShell("", anonymousCwd, true);
      if (!embedded) void refreshTerminalSessions();
    })();

    return () => {
      resizeObserver.disconnect();
      socketRef.current?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  function writeTerminal(value: string) {
    terminalRef.current?.write(value);
  }

  function sendTerminalSize() {
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    if (!terminal || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
  }

  async function refreshTerminalSessions() {
    const response = await fetch("/api/terminal/sessions", {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return [];
    const sessions = (await response.json()) as TerminalSessionSummary[];
    setTerminalSessions(sessions);
    return sessions;
  }

  async function createShellSession(name?: string, nextCwd = cwd) {
    const body: CreateTerminalSessionRequest = { name, cwd: nextCwd };
    const response = await fetch("/api/terminal/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      writeTerminal(`\r\n[${t("terminal.createSessionFailed")}]\r\n`);
      return null;
    }
    const session = (await response.json()) as TerminalSessionSummary;
    setTerminalSessions((items) => [session, ...items.filter((item) => item.id !== session.id)]);
    setActiveTerminalId(session.id);
    return session;
  }

  function nextShellName(sessions: TerminalSessionSummary[]) {
    const names = new Set(sessions.map((session) => session.name));
    let index = 1;
    while (names.has(`shell ${index}`)) index += 1;
    return `shell ${index}`;
  }

  async function newShellSession() {
    const name = await dialog.prompt({
      title: t("terminal.newShell"),
      message: `${t("terminal.workingDirectory")}：${cwd}`,
      defaultValue: `shell ${terminalSessions.length + 1}`,
      placeholder: t("terminal.sessionName"),
      confirmLabel: t("action.create"),
    });
    if (name === null) return;
    const session = await createShellSession(name, cwd);
    if (session) {
      setTerminalSessionsPanelOpen(false);
      connectShell(session.id);
    }
  }

  async function reopenSelectedShell(selected = terminalSessions.find((item) => item.id === activeTerminalId)) {
    const session = await createShellSession(selected ? `${selected.name} copy` : undefined, selected?.cwd ?? cwd);
    if (session) connectShell(session.id);
  }

  async function closeShellSession(id: string) {
    const session = terminalSessions.find((item) => item.id === id);
    const confirmed = await dialog.confirm({
      title: t("terminal.deleteSession"),
      message: session ? `${t("terminal.deleteSession")}：${session.name}` : t("terminal.deleteSessionFallback"),
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const closingActiveConnection = id === activeTerminalId && connected;
    await fetch(`/api/terminal/sessions/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const sessions = await refreshTerminalSessions();
    if (closingActiveConnection) {
      socketRef.current?.close();
      terminalRef.current?.reset();
      setConnected(false);
    }
    const currentStillExists = sessions.some((item) => item.id === id);
    if (!currentStillExists) setActiveTerminalId("");
  }

  async function renameShellSession(sessionId = activeTerminalId) {
    const session = terminalSessions.find((item) => item.id === sessionId);
    if (!session) return;
    const name = await dialog.prompt({
      title: t("terminal.renameSession"),
      defaultValue: session.name,
      placeholder: t("terminal.sessionNamePlaceholder"),
      confirmLabel: t("action.rename"),
    });
    if (!name || name === session.name) return;
    const body: UpdateTerminalSessionRequest = { name };
    const response = await fetch(`/api/terminal/sessions/${session.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const updated = (await response.json()) as TerminalSessionSummary;
    setTerminalSessions((items) => items.map((item) => item.id === updated.id ? updated : item));
  }

  function connectShell(sessionId = activeTerminalId, connectCwd = cwd, ephemeral = false) {
    if (!sessionId && !ephemeral) {
      writeTerminal(`\r\n${t("terminal.createOrSelectShell")}\r\n`);
      return;
    }
    const target = terminalSessions.find((item) => item.id === sessionId);
    if (target && target.status !== "running") {
      setActiveTerminalId(target.id);
      void reopenSelectedShell(target);
      return;
    }
    socketRef.current?.close();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL("/api/terminal/ws", window.location.href);
    url.protocol = protocol;
    url.searchParams.set("token", sessionToken);
    if (sessionId) url.searchParams.set("sessionId", sessionId);
    else {
      url.searchParams.set("cwd", connectCwd);
      if (ephemeral) url.searchParams.set("ephemeral", "true");
    }
    const socket = new WebSocket(url);
    const connectingEphemeral = ephemeral;
    socketRef.current = socket;
    terminalModeRef.current = "pty";
    terminalRef.current?.reset();
    writeTerminal(`${t("terminal.connecting")}\r\n`);
    socket.addEventListener("open", () => {
      setConnected(true);
      terminalRef.current?.focus();
      sendTerminalSize();
    });
    socket.addEventListener("error", () => writeTerminal(`\r\n[${t("terminal.ptyConnectionError")}]\r\n`));
    socket.addEventListener("close", (event) => {
      setConnected(false);
      if (event.code !== 1000) {
        writeTerminal(`\r\n[${t("terminal.ptyClosed").replace("{code}", String(event.code)).replace("{reason}", event.reason ? ` ${event.reason}` : "")}]\r\n`);
      }
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type: string; data?: string; cwd?: string; mode?: string; exitCode?: number; error?: string; warning?: string; session?: TerminalSessionSummary };
      if (message.type === "ready") {
        const readySession = message.session ?? null;
        if (readySession && !connectingEphemeral) {
          setActiveTerminalId(readySession.id);
          setTerminalSessions((items) => [readySession, ...items.filter((item) => item.id !== readySession.id)]);
        }
        terminalModeRef.current = message.mode === "pipe" ? "pipe" : "pty";
        writeTerminal(`${t("terminal.connectedTo").replace("{cwd}", message.cwd ?? "").replace("{mode}", message.mode ?? "pty")}\r\n`);
        terminalRef.current?.focus();
      }
      if (message.type === "warning") writeTerminal(`[${t("terminal.warning").replace("{message}", message.warning ?? "")}]\r\n`);
      if (message.type === "output" && message.data) terminalRef.current?.write(message.data);
      if (message.type === "exit") writeTerminal(`\r\n[${t("terminal.processExited").replace("{code}", String(message.exitCode ?? ""))}]\r\n`);
      if (message.type === "error") writeTerminal(`\r\n[${t("terminal.error").replace("{message}", message.error ?? "")}]\r\n`);
    });
  }

  function disconnectShell() {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
    writeTerminal(`\r\n[${t("terminal.disconnected")}]\r\n`);
  }

  function renderTerminalSessions() {
    return (
      <>
        <div className="pane-title">{t("terminal.sessions")}</div>
        <div className="terminal-field">
          <input name="terminalsearch" value={terminalSearch} onChange={(event) => setTerminalSearch(event.target.value)} placeholder={t("terminal.searchSessions")} />
          <select name="terminalstatusfilter" value={terminalStatusFilter} onChange={(event) => setTerminalStatusFilter(event.target.value)}>
            <option value="">{t("session.allStatuses")}</option>
            <option value="running">{t("session.statusRunning")}</option>
            <option value="closed">{t("action.disconnect")}</option>
          </select>
        </div>
        <div className="terminal-field terminal-create-row">
          <label>
            <span>{t("terminal.newSessionCwd")}</span>
            <input name="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} />
          </label>
          <button className="icon-button" type="button" onClick={newShellSession} title={t("terminal.newShell")} aria-label={t("terminal.newShell")}>
            <TerminalIcon size={15} />
          </button>
        </div>
        {visibleTerminalSessions.map((session) => (
          <div className={`session-row ${session.id === activeTerminalId ? "active" : ""}`} key={session.id}>
            <button
              className="session"
              type="button"
              onClick={() => {
                setActiveTerminalId(session.id);
                setTerminalSessionsPanelOpen(false);
                if (session.status === "running") connectShell(session.id);
              }}
            >
              <strong>{session.name}</strong>
              <span>{session.status} · {session.mode} · {session.cwd}</span>
            </button>
            <div className="session-actions">
              <button className="icon-button" type="button" onClick={() => void renameShellSession(session.id)} title={t("action.rename")} aria-label={`${t("action.rename")} ${session.name}`}>
                <Pencil size={14} />
              </button>
              <button className="icon-button danger-button" type="button" onClick={() => void closeShellSession(session.id)} title={t("action.delete")} aria-label={`${t("action.delete")} ${session.name}`}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {!visibleTerminalSessions.length && <div className="empty-state">{t("terminal.noSessions")}</div>}
      </>
    );
  }

  return (
    <main className={`terminal-page ${embedded ? "embedded-page" : ""}`}>
      {dialog.node}
      {!embedded && <PageHeader crumb={`${t("page.global")} / ${t("nav.terminal")}`} title={t("page.terminal")} action={connected ? t("action.disconnect") : activeTerminalSession?.status === "closed" ? t("action.reconnect") : t("action.connect")} onAction={connected ? disconnectShell : activeTerminalSession?.status === "closed" ? reopenSelectedShell : activeTerminalSession ? connectShell : () => connectShell("", cwd, true)} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.terminal")} />}
      <section className={`terminal-workbench ${embedded ? "locked-workspace" : ""}`}>
        {!embedded && (
          <aside className="session-pane">
            {renderTerminalSessions()}
          </aside>
        )}
        <section className="shell-pane">
          <div className="shell-head">
            <div><strong>{t("terminal.hostShell")}</strong><div className="subtle">{connected ? t("terminal.xtermConnected") : t("terminal.xtermDisconnected")}</div></div>
            {!embedded && (
              <div className="shell-head-actions">
                <button className="ghost-button icon-only terminal-mobile-sessions" type="button" title={t("terminal.sessions")} aria-label={t("terminal.sessions")} onClick={() => setTerminalSessionsPanelOpen(true)}><History size={16} /></button>
              </div>
            )}
            {embedded && <button className="ghost-button" type="button" onClick={connected ? disconnectShell : () => connectShell("", requestedCwd ?? cwd, true)}><IconText icon={connected ? Square : Play}>{connected ? t("action.disconnect") : t("action.connect")}</IconText></button>}
          </div>
          <div className="terminal-console">
            <div className="xterm-host" ref={terminalHostRef} />
          </div>
        </section>
      </section>
      {!embedded && terminalSessionsPanelOpen && (
        <div className="workspace-modal compact-modal terminal-sessions-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("terminal.sessions")}</strong>
              <span>{cwd}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setTerminalSessionsPanelOpen(false)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <div className="session-pane modal-session-pane">
            {renderTerminalSessions()}
          </div>
        </div>
      )}
    </main>
  );
}
