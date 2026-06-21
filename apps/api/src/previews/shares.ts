import { spawn as spawnProcess, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as connectNet, type Socket } from "node:net";
import type { PreviewSummary } from "@codex-web/protocol";

type PreviewRecord = Omit<PreviewSummary, "url"> & { token: string };

type PreviewAccessRequest = {
  id: string;
  previewId: string;
  secret: string;
  status: "pending" | "approved" | "denied";
  approvedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
};

type PreviewShareStatus = "starting" | "running" | "stopped" | "error";

export type PreviewShareSummary = {
  previewId: string;
  status: PreviewShareStatus;
  publicUrl?: string;
  gatewayPort?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type PreviewShareRecord = PreviewShareSummary & {
  gateway?: Server;
  tunnel?: ChildProcess;
};

type PreviewShareRuntimeDeps = {
  appendPreviewLog: (previewId: string, value: string) => void;
  createPreviewAccessRequest: (preview: PreviewRecord, sourceUrl: URL) => { id: string; secret: string; reused?: boolean };
  expirePreviewAccessRequests: () => void;
  getPreviewAccessRequest: (preview: PreviewRecord, requestId: string, secret: string | null) => PreviewAccessRequest | null;
  previewAccessCookie: (preview: PreviewRecord, ttlMs?: number) => string;
  previews: Map<string, PreviewRecord>;
  requestHasPreviewAccess: (preview: PreviewRecord, request: IncomingMessage) => boolean;
};

const cftunnelUrlPattern = /https:\/\/[^\s"'<>]+\.trycloudflare\.com\b/ig;
const ownerGrantTtlMs = 90 * 1000;

export function createPreviewShareRuntime(deps: PreviewShareRuntimeDeps) {
  const {
    appendPreviewLog,
    createPreviewAccessRequest,
    expirePreviewAccessRequests,
    getPreviewAccessRequest,
    previewAccessCookie,
    previews,
    requestHasPreviewAccess,
  } = deps;
  const shares = new Map<string, PreviewShareRecord>();
  const ownerGrants = new Map<string, { previewId: string; returnTo: string; expiresAt: number }>();

  function publicShare(record: PreviewShareRecord): PreviewShareSummary {
    return {
      previewId: record.previewId,
      status: record.status,
      publicUrl: record.publicUrl,
      gatewayPort: record.gatewayPort,
      error: record.error,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async function startPreviewShare(preview: PreviewRecord) {
    const existing = shares.get(preview.id);
    if (existing && (existing.status === "starting" || existing.status === "running")) {
      return publicShare(existing);
    }
    stopPreviewShare(preview.id);

    const now = new Date().toISOString();
    const record: PreviewShareRecord = {
      previewId: preview.id,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    };
    shares.set(preview.id, record);

    try {
      const gateway = await createGateway(preview);
      const address = gateway.address();
      if (!address || typeof address === "string") throw new Error("preview_share_gateway_port_unavailable");
      record.gateway = gateway;
      record.gatewayPort = address.port;
      record.updatedAt = new Date().toISOString();
      appendPreviewLog(preview.id, `\n[share] auth gateway listening on 127.0.0.1:${address.port}\n`);

      const binary = process.env.CFTUNNEL_BIN || "cftunnel";
      const tunnel = spawnProcess(binary, ["quick", String(address.port)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        detached: process.platform !== "win32",
      });
      record.tunnel = tunnel;
      appendPreviewLog(preview.id, `[share] starting cftunnel quick ${address.port}\n`);

      tunnel.stdout?.on("data", (chunk) => handleTunnelOutput(record, preview, chunk.toString()));
      tunnel.stderr?.on("data", (chunk) => handleTunnelOutput(record, preview, chunk.toString()));
      tunnel.once("error", (error) => {
        record.status = "error";
        record.error = error.message;
        record.updatedAt = new Date().toISOString();
        appendPreviewLog(preview.id, `[share error] ${error.message}\n`);
        closeGateway(record);
      });
      tunnel.once("exit", (code) => {
        record.tunnel = undefined;
        if (record.status === "stopped") return;
        record.status = code === 0 ? "stopped" : "error";
        record.error = code === 0 ? undefined : `cftunnel exited with ${code ?? "null"}`;
        record.updatedAt = new Date().toISOString();
        appendPreviewLog(preview.id, `[share exit] ${code ?? "null"}\n`);
        closeGateway(record);
      });
      return publicShare(record);
    } catch (error) {
      record.status = "error";
      record.error = error instanceof Error ? error.message : "preview_share_start_failed";
      record.updatedAt = new Date().toISOString();
      appendPreviewLog(preview.id, `[share error] ${record.error}\n`);
      closeGateway(record);
      return publicShare(record);
    }
  }

  function stopPreviewShare(previewId: string) {
    const record = shares.get(previewId);
    if (!record) return null;
    record.status = "stopped";
    record.updatedAt = new Date().toISOString();
    killTunnel(record.tunnel);
    closeGateway(record);
    appendPreviewLog(previewId, "[share] stopped\n");
    return publicShare(record);
  }

  function getPreviewShare(previewId: string) {
    const record = shares.get(previewId);
    return record ? publicShare(record) : null;
  }

  function createPreviewShareGrantUrl(preview: PreviewRecord, returnTo = "/") {
    const record = shares.get(preview.id);
    if (!record?.publicUrl) throw new Error("preview_share_not_running");
    const path = normalizeReturnTo(returnTo);
    if (preview.access !== "private") return new URL(path, record.publicUrl).toString();
    expireOwnerGrants();
    const token = randomUUID();
    ownerGrants.set(token, {
      previewId: preview.id,
      returnTo: path,
      expiresAt: Date.now() + ownerGrantTtlMs,
    });
    const url = new URL("/.codex-preview/grant", record.publicUrl);
    url.searchParams.set("token", token);
    return url.toString();
  }

  function handleOwnerGrant(preview: PreviewRecord, sourceUrl: URL, response: ServerResponse) {
    expireOwnerGrants();
    const token = sourceUrl.searchParams.get("token") ?? "";
    const grant = token ? ownerGrants.get(token) : null;
    if (!grant || grant.previewId !== preview.id) return writeText(response, 401, "preview share grant expired");
    ownerGrants.delete(token);
    response.writeHead(303, {
      "cache-control": "no-store",
      "location": grant.returnTo,
      "set-cookie": previewAccessCookie(preview),
    });
    response.end();
  }

  function expireOwnerGrants() {
    const now = Date.now();
    for (const [token, grant] of ownerGrants) {
      if (grant.expiresAt <= now) ownerGrants.delete(token);
    }
  }

  async function createGateway(preview: PreviewRecord) {
    const server = createServer((request, response) => {
      void handleGatewayRequest(preview.id, request, response);
    });
    server.on("upgrade", (request, socket, head) => {
      void handleGatewayUpgrade(preview.id, request, socket as Socket, head);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    return server;
  }

  async function handleGatewayRequest(previewId: string, request: IncomingMessage, response: ServerResponse) {
    const preview = previews.get(previewId);
    if (!preview) return writeText(response, 404, "preview not found");
    const sourceUrl = new URL(request.url || "/", `http://${request.headers.host || "preview.local"}`);
    if (sourceUrl.pathname === "/.codex-preview/grant" && request.method === "GET") {
      return handleOwnerGrant(preview, sourceUrl, response);
    }
    if (sourceUrl.pathname === "/.codex-preview/access-requests" && request.method === "POST") {
      if (preview.access !== "private") return writeJson(response, 400, { error: "preview_is_public" });
      const accessRequest = createPreviewAccessRequest(preview, sourceUrl);
      return writeJson(response, 202, { status: "pending", ...accessRequest });
    }
    const accessMatch = sourceUrl.pathname.match(/^\/\.codex-preview\/access-requests\/([^/]+)$/);
    if (accessMatch && request.method === "GET") {
      expirePreviewAccessRequests();
      const accessRequest = getPreviewAccessRequest(preview, accessMatch[1], sourceUrl.searchParams.get("secret"));
      if (!accessRequest) return writeJson(response, 404, { error: "access_request_not_found" });
      if (accessRequest.status === "approved") {
        const approvedUntil = accessRequest.approvedUntil ? new Date(accessRequest.approvedUntil).getTime() : Date.now() + 15 * 60 * 1000;
        response.setHeader("set-cookie", previewAccessCookie(preview, Math.max(1, approvedUntil - Date.now())));
      }
      return writeJson(response, 200, { status: accessRequest.status, approvedUntil: accessRequest.approvedUntil ?? null });
    }
    if (!requestHasPreviewAccess(preview, request)) {
      if (request.method === "GET" || request.method === "HEAD") return writeAccessPage(response, sourceUrl);
      return writeText(response, 401, "private preview requires access");
    }
    return proxyHttp(preview, request, response);
  }

  function handleGatewayUpgrade(previewId: string, request: IncomingMessage, socket: Socket, head: Buffer) {
    const preview = previews.get(previewId);
    if (!preview || !requestHasPreviewAccess(preview, request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const upstream = connectNet(preview.port, preview.targetHost, () => {
      upstream.write(`${request.method} ${request.url || "/"} HTTP/${request.httpVersion}\r\n`);
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        upstream.write(`${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`);
      }
      upstream.write("\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
  }

  function proxyHttp(preview: PreviewRecord, request: IncomingMessage, response: ServerResponse) {
    const upstream = new URL(request.url || "/", `http://${preview.targetHost}:${preview.port}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || name.toLowerCase() === "host") continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("host", `${preview.targetHost}:${preview.port}`);
    const proxyRequest = globalThis.fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request as unknown as BodyInit,
      duplex: "half",
      redirect: "manual",
    } as RequestInit & { duplex: "half" });
    proxyRequest.then(async (upstreamResponse) => {
      response.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers.entries()));
      if (!upstreamResponse.body) return response.end();
      for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) response.write(chunk);
      response.end();
    }).catch((error) => {
      appendPreviewLog(preview.id, `[share proxy error] ${error instanceof Error ? error.message : String(error)}\n`);
      if (!response.headersSent) writeText(response, 502, "preview share proxy failed");
      else response.destroy();
    });
  }

  function handleTunnelOutput(record: PreviewShareRecord, preview: PreviewRecord, value: string) {
    appendPreviewLog(preview.id, value);
    const publicUrl = Array.from(value.matchAll(cftunnelUrlPattern))
      .map((match) => match[0])
      .find((url) => {
        try {
          const parsed = new URL(url);
          return parsed.hostname !== "api.trycloudflare.com";
        } catch {
          return false;
        }
      });
    if (publicUrl && !record.publicUrl) {
      record.publicUrl = publicUrl;
      record.status = "running";
      record.updatedAt = new Date().toISOString();
      appendPreviewLog(preview.id, `[share] public url ${record.publicUrl}\n`);
    }
  }

  return {
    createPreviewShareGrantUrl,
    getPreviewShare,
    shares,
    startPreviewShare,
    stopPreviewShare,
  };
}

function closeGateway(record: PreviewShareRecord) {
  try {
    record.gateway?.close();
  } catch {
    // Already closed.
  }
  record.gateway = undefined;
}

function killTunnel(tunnel?: ChildProcess) {
  if (!tunnel) return;
  if (tunnel.pid && process.platform !== "win32") {
    try {
      process.kill(-tunnel.pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-tunnel.pid!, "SIGKILL");
        } catch {
          // Process group already exited.
        }
      }, 2500).unref();
      return;
    } catch {
      // Fall back to killing the child process below.
    }
  }
  try {
    tunnel.kill("SIGTERM");
  } catch {
    // Already gone.
  }
}

function normalizeReturnTo(value: string) {
  const trimmed = value.trim() || "/";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return "/";
  return `/${trimmed.replace(/^\/+/, "")}`;
}

function writeJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function writeText(response: ServerResponse, status: number, value: string) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end(value);
}

function writeAccessPage(response: ServerResponse, sourceUrl: URL) {
  const returnTo = `${sourceUrl.pathname}${sourceUrl.search}${sourceUrl.hash}`;
  response.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Private Preview Share</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f4; color: #172018; }
    main { width: min(460px, calc(100vw - 32px)); border: 1px solid #d9ded6; border-radius: 10px; background: white; padding: 20px; box-shadow: 0 24px 80px rgba(14, 20, 16, .16); }
    h1 { margin: 0 0 8px; font-size: 18px; }
    p { margin: 0 0 14px; color: #586256; }
    button { min-height: 34px; border-radius: 8px; border: 1px solid #172018; background: #172018; color: white; padding: 0 12px; cursor: pointer; }
    .muted { margin-top: 12px; font-size: 12px; color: #7a8378; }
  </style>
</head>
<body>
  <main>
    <h1>私有公开预览需要授权</h1>
    <p id="message">这是一个私有预览分享。请发起访问请求，等待 Codex Web 管理员批准。</p>
    <button id="request" type="button">请求授权</button>
    <p class="muted">Access is granted per preview share after approval.</p>
  </main>
  <script>
    (() => {
      const message = document.getElementById("message");
      const button = document.getElementById("request");
      let timer = null;
      async function poll(id, secret) {
        const response = await fetch("/.codex-preview/access-requests/" + encodeURIComponent(id) + "?secret=" + encodeURIComponent(secret), { cache: "no-store" });
        const result = await response.json().catch(() => null);
        if (response.ok && result?.status === "approved") {
          message.textContent = "授权已批准，正在打开预览...";
          window.location.replace(${JSON.stringify(returnTo)});
          return;
        }
        if (result?.status === "denied") {
          message.textContent = "授权请求已被拒绝。";
          if (timer) window.clearInterval(timer);
        }
      }
      button.addEventListener("click", async () => {
        button.disabled = true;
        message.textContent = "正在创建授权请求...";
        const response = await fetch("/.codex-preview/access-requests", { method: "POST" });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.id || !result?.secret) {
          message.textContent = "授权请求创建失败，请回到 Codex Web 后重试。";
          button.disabled = false;
          return;
        }
        message.textContent = "授权请求已发送，请等待审批通过。";
        timer = window.setInterval(() => void poll(result.id, result.secret), 2000);
        void poll(result.id, result.secret);
      });
    })();
  </script>
</body>
</html>`);
}
