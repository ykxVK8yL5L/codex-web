import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { ApprovalActionType, ApprovalSummary, PreviewSummary } from "@codex-web/protocol";

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

type PreviewAccessServiceDeps = {
  createApproval: (input: {
    actionType: ApprovalActionType;
    risk: ApprovalSummary["risk"];
    title: string;
    description: string;
    details: string;
    payload: Record<string, unknown>;
  }) => unknown;
  expirePreviewAccessRequests: () => void;
  getBearerToken: (header?: string) => string | null;
  parseCookieHeader: (value?: string) => Map<string, string>;
  previewAccessRequests: Map<string, PreviewAccessRequest>;
  previewUrl: (preview: PreviewRecord) => string;
  sessionCookieName: string;
  signPreviewAccessToken: (preview: PreviewRecord, ttlMs: number) => string;
  upsertPreviewAccessRequest: (request: PreviewAccessRequest) => void;
  verifyPreviewAccessToken: (preview: PreviewRecord, value?: string | null) => boolean;
  verifySessionToken: (token: string | null) => boolean;
};

const previewAccessTtlMs = 12 * 60 * 60 * 1000;

export function createPreviewAccessService(deps: PreviewAccessServiceDeps) {
  const {
    createApproval,
    expirePreviewAccessRequests,
    getBearerToken,
    parseCookieHeader,
    previewAccessRequests,
    previewUrl,
    sessionCookieName,
    signPreviewAccessToken,
    upsertPreviewAccessRequest,
    verifyPreviewAccessToken,
    verifySessionToken,
  } = deps;

  function previewAccessCookieName(previewId: string) {
    return `codex_preview_${previewId.replace(/[^a-zA-Z0-9]/g, "_")}`;
  }

  function previewAccessCookie(preview: PreviewRecord, ttlMs = previewAccessTtlMs) {
    return `${previewAccessCookieName(preview.id)}=${encodeURIComponent(signPreviewAccessToken(preview, ttlMs))}; Path=/; Max-Age=${Math.max(1, Math.floor(ttlMs / 1000))}; HttpOnly; SameSite=Lax`;
  }

  function requestHasPreviewAccess(preview: PreviewRecord, request: Request | IncomingMessage) {
    if (preview.access === "public") return true;
    const cookieHeader = request instanceof Request ? request.headers.get("cookie") ?? undefined : request.headers.cookie;
    const cookies = parseCookieHeader(cookieHeader);
    if (verifyPreviewAccessToken(preview, cookies.get(previewAccessCookieName(preview.id)))) return true;
    if (verifySessionToken(cookies.get(sessionCookieName) ?? null)) return true;
    const authorization = request instanceof Request ? request.headers.get("authorization") ?? undefined : request.headers.authorization;
    return verifySessionToken(getBearerToken(Array.isArray(authorization) ? authorization[0] : authorization) ?? null);
  }

  function createPreviewAccessRequest(preview: PreviewRecord, sourceUrl: URL) {
    expirePreviewAccessRequests();
    const existing = Array.from(previewAccessRequests.values()).find((request) =>
      request.previewId === preview.id
      && request.status === "pending"
      && Date.now() - new Date(request.createdAt).getTime() < 15 * 60 * 1000
    );
    if (existing) return { id: existing.id, secret: existing.secret, reused: true };
    const id = `preview-access-${randomUUID()}`;
    const secret = randomUUID();
    const now = new Date().toISOString();
    const request: PreviewAccessRequest = {
      id,
      previewId: preview.id,
      secret,
      status: "pending",
      approvedUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    upsertPreviewAccessRequest(request);
    createApproval({
      actionType: "preview-access",
      risk: "low",
      title: "Private preview access request",
      description: `Allow temporary access to private preview ${preview.label}.`,
      details: [
        `preview=${preview.label}`,
        `previewId=${preview.id}`,
        `target=${preview.targetHost}:${preview.port}`,
        `requestId=${id}`,
        `url=${sourceUrl.pathname}`,
      ].join("\n"),
      payload: { requestId: id, previewId: preview.id, url: sourceUrl.pathname },
    });
    return { id, secret };
  }

  function getPreviewAccessRequest(preview: PreviewRecord, requestId: string, secret: string | null) {
    const request = previewAccessRequests.get(requestId);
    if (!request || request.previewId !== preview.id || request.secret !== (secret ?? "")) return null;
    return request;
  }

  function privatePreviewAccessResponse(preview: PreviewRecord, sourceUrl: URL) {
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Private Preview</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f4; color: #172018; }
    main { width: min(460px, calc(100vw - 32px)); border: 1px solid #d9ded6; border-radius: 10px; background: white; padding: 20px; box-shadow: 0 24px 80px rgba(14, 20, 16, .16); }
    h1 { margin: 0 0 8px; font-size: 18px; }
    p { margin: 0 0 14px; color: #586256; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    a, button { display: inline-flex; align-items: center; min-height: 34px; border-radius: 8px; border: 1px solid #cdd5ca; background: #172018; color: white; padding: 0 12px; text-decoration: none; cursor: pointer; }
    a.secondary { background: white; color: #172018; }
    .muted { margin-top: 12px; font-size: 12px; color: #7a8378; }
  </style>
</head>
<body>
  <main>
    <h1>私有预览需要授权</h1>
    <h1>私有预览需要授权</h1>
    <p id="message">这是一个私有预览。你可以发起访问授权请求，等待 Codex Web 管理员批准。</p>
    <div class="actions">
      <button id="request" type="button">请求授权</button>
      <a class="secondary" href="${sourceUrl.origin}/#approvals">打开审批页面</a>
      <a class="secondary" href="${sourceUrl.origin}/#previews">打开预览列表</a>
    </div>
    <p class="muted">Private preview requires an authenticated Codex Web session.</p>
  </main>
  <script>
    (() => {
      const message = document.getElementById("message");
      const button = document.getElementById("request");
      let timer = null;
      async function poll(id, secret) {
        const response = await fetch(${JSON.stringify(`${previewUrl(preview).replace(/\/+$/, "")}/access-requests/`)} + encodeURIComponent(id) + "?secret=" + encodeURIComponent(secret), { cache: "no-store" });
        const result = await response.json().catch(() => null);
        if (response.ok && result?.status === "approved") {
          message.textContent = "授权已批准，正在打开预览...";
          window.location.replace(${JSON.stringify(`${sourceUrl.pathname}${sourceUrl.search}${sourceUrl.hash}`)});
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
        const response = await fetch(${JSON.stringify(`${previewUrl(preview).replace(/\/+$/, "")}/access-requests`)}, { method: "POST" });
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
</html>`;
    return new Response(html, {
      status: 401,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return {
    createPreviewAccessRequest,
    getPreviewAccessRequest,
    previewAccessCookie,
    previewAccessCookieName,
    privatePreviewAccessResponse,
    requestHasPreviewAccess,
  };
}
