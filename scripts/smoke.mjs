const apiBase = process.env.CODEX_WEB_SMOKE_API ?? "http://127.0.0.1:8787";
const webBase = process.env.CODEX_WEB_SMOKE_WEB ?? "http://127.0.0.1:5173";
const sessionToken = process.env.CODEX_WEB_SMOKE_SESSION_TOKEN ?? "";

const checks = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    checks.push({ name, ok: true, skipped: result === "skip", durationMs: Date.now() - started });
  } catch (error) {
    checks.push({ name, ok: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
  }
}

async function fetchText(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function authHeaders() {
  return sessionToken ? { authorization: `Bearer ${sessionToken}` } : {};
}

await check("web entry returns html", async () => {
  const { response, text } = await fetchText(`${webBase}/`);
  assert(response.ok, `expected 2xx, got ${response.status}`);
  assert(text.includes("<!doctype html") || text.includes("<div id=\"root\""), "web entry did not look like the app shell");
});

await check("api auth state returns expected shape", async () => {
  const { response, text } = await fetchText(`${apiBase}/api/auth/state`);
  assert(response.ok, `expected 2xx, got ${response.status}`);
  const state = JSON.parse(text);
  assert(typeof state.authenticated === "boolean", "missing authenticated flag");
  assert(typeof state.setupRequired === "boolean", "missing setupRequired flag");
  assert(typeof state.needsOtp === "boolean", "missing needsOtp flag");
});

await check("protected endpoint rejects anonymous requests", async () => {
  const { response } = await fetchText(`${apiBase}/api/projects?limit=1`);
  assert(response.status === 401, `expected 401, got ${response.status}`);
});

await check("authenticated projects route works when token is supplied", async () => {
  if (!sessionToken) return "skip";
  const { response, text } = await fetchText(`${apiBase}/api/projects?limit=1`, { headers: authHeaders() });
  assert(response.ok, `expected 2xx, got ${response.status}: ${text.slice(0, 200)}`);
  const page = JSON.parse(text);
  assert(Array.isArray(page.items), "projects response is not a page");
});

await check("authenticated core list routes work when token is supplied", async () => {
  if (!sessionToken) return "skip";
  const routes = [
    "/api/sessions?limit=1",
    "/api/providers",
    "/api/automations?limit=1",
    "/api/previews?limit=1",
    "/api/agents?limit=1",
    "/api/agent-groups?limit=1",
    "/api/agent-roles?limit=1",
    "/api/agent-circles?limit=1",
    "/api/approvals?limit=1",
  ];
  for (const route of routes) {
    const { response, text } = await fetchText(`${apiBase}${route}`, { headers: authHeaders() });
    assert(response.ok, `${route} expected 2xx, got ${response.status}: ${text.slice(0, 200)}`);
  }
});

await check("task context route returns expected shape when a session exists", async () => {
  if (!sessionToken) return "skip";
  const sessionsResult = await fetchText(`${apiBase}/api/sessions?limit=1`, { headers: authHeaders() });
  assert(sessionsResult.response.ok, `sessions expected 2xx, got ${sessionsResult.response.status}: ${sessionsResult.text.slice(0, 200)}`);
  const sessionsPage = JSON.parse(sessionsResult.text);
  const session = sessionsPage.items?.[0];
  if (!session?.id) return "skip";
  const { response, text } = await fetchText(`${apiBase}/api/codex/tasks/${encodeURIComponent(session.id)}/context`, { headers: authHeaders() });
  assert(response.ok, `context expected 2xx, got ${response.status}: ${text.slice(0, 200)}`);
  const context = JSON.parse(text);
  assert(context.sessionId === session.id, "context session id mismatch");
  assert(Array.isArray(context.files), "context files is not an array");
  const contextPack = context.files.find((file) => file.name === "context-pack.md");
  if (!contextPack) return;
  const fileResult = await fetchText(`${apiBase}/api/codex/tasks/${encodeURIComponent(session.id)}/context/context-pack.md`, { headers: authHeaders() });
  assert(fileResult.response.ok, `context file expected 2xx, got ${fileResult.response.status}: ${fileResult.text.slice(0, 200)}`);
  const file = JSON.parse(fileResult.text);
  assert(file.name === "context-pack.md", "context file name mismatch");
  assert(typeof file.content === "string", "context file content is not a string");
});

const failed = checks.filter((item) => !item.ok);
for (const item of checks) {
  const status = item.skipped ? "SKIP" : item.ok ? "OK" : "FAIL";
  const suffix = item.ok ? "" : ` - ${item.error}`;
  console.log(`${status} ${item.name} (${item.durationMs}ms)${suffix}`);
}

if (failed.length) process.exit(1);
