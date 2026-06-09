# Codex Web App

Codex Web App is a local web workspace for running Codex-based development tasks, managing providers, projects, previews, terminals, sessions, and multi-agent rooms.

## Requirements

- Node.js 20 or newer
- pnpm 9.x
- Codex CLI
- Git, recommended for project workspaces and room worktrees

Install pnpm if needed:

```bash
npm install -g pnpm
```

Install Codex CLI:

```bash
npm install -g @openai/codex
```

Verify Codex:

```bash
codex --version
```

## Install

Install project dependencies from the repository root:

```bash
pnpm install
```

## Development

Start both the API and web frontend:

```bash
pnpm run dev
```

Default local services:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- PTY WebSocket: `ws://localhost:8788`

Run only one side when needed:

```bash
pnpm run dev:web
pnpm run dev:api
```

The API `dev` script is not watch mode. Restart the API after backend code changes, or use the API package watch script manually:

```bash
pnpm --filter @codex-web/api dev:watch
```

## Checks

Run TypeScript checks:

```bash
pnpm run check
```

Run the smoke test:

```bash
pnpm run smoke
```

## Runtime Data

Runtime data is stored under:

```text
apps/api/data/
```

This directory is ignored by git. It may contain local SQLite databases, sessions, task logs, preview logs, generated workspaces, and other runtime state.

New session-scoped runtime files are grouped under:

```text
apps/api/data/sessions/<sessionId>/
```

Room conversations also use the parent Room session directory for shared Room files, Agent fallback workspaces, Agent child session logs/context, and Room worktrees. The legacy `apps/api/data/rooms` path is only retained for older data or records without a parent session.

Codex CLI also writes its own session records under:

```text
~/.codex/sessions/
```

These files are managed by Codex CLI and are separate from this application's database.

## Deployment Notes

For local or single-host deployment, expose one public web port and route API requests through the frontend host or a reverse proxy.

Required internal services:

- Web frontend: `5173`
- API server: `8787`
- PTY WebSocket: `8788`

Recommended external exposure:

- Expose only the frontend/reverse-proxy port.
- Proxy `/api/*` to `http://127.0.0.1:8787`.
- Proxy WebSocket terminal traffic to `ws://127.0.0.1:8788`.
- Keep preview services private unless explicitly using public preview mode.

Example development deployment:

```bash
pnpm install
pnpm run dev
```

### Docker Deployment

Build the image from the repository root:

```bash
docker build -t codex-web-app .
```

Run the container:

```bash
docker run -d --name codex-web \
  -p 5173:5173 \
  -v codex-web-data:/app/apps/api/data \
  codex-web-app
```

Open the app at:

```text
http://localhost:5173
```

The Docker image runs Nginx on `5173`, serves the built frontend, and proxies `/api/*` and `/preview/*` to the API service inside the container. The startup script registers both the API process and Nginx directly with PM2 using `pm2 start ...`, then keeps the container foregrounded with `pm2 logs --raw`. The API listens on `8787` internally. Expose `8787` only when direct API access is needed:

```bash
-p 8787:8787
```

The `codex-web-data` volume stores the application database, sessions, rooms, preview logs, generated workspaces, settings, providers, and other runtime data from `apps/api/data`.

The image installs the Codex CLI with `npm install -g @openai/codex`, installs PM2 for process supervision, and installs `mise` into `/usr/local/bin/mise` during the runtime stage. The API invokes `codex` for tasks and uses `mise` for Settings -> Environment Management runtime installs and probes inside the container.

The restore workflow may create automatic pre-restore backup ZIP files under `/app/apps/api/restore-backups` inside the container before overwriting `apps/api/data`. This directory is not an auto-restore input folder and is not mounted by default. To restore a backup, upload the backup ZIP from the web UI.

The Docker image also includes `docker/sync.sh` in the source tree for optional rclone-based data sync. It reads `REMOTE_FOLDER` as the remote root and preserves local absolute paths below that root:

```bash
REMOTE_FOLDER=remote:codex-web-backup sh docker/sync.sh backup
REMOTE_FOLDER=remote:codex-web-backup sh docker/sync.sh restore
```

For example, `/app/apps/api/data` is synced to `remote:codex-web-backup/app/apps/api/data`. This is a file-level convenience sync for container data. Restores should be run before the API starts, and hot backups of a running SQLite-backed data directory are best-effort rather than a strict transactional snapshot.

For production-style deployment without Docker, build the web app and run the API behind a process manager or container supervisor:

```bash
pnpm --filter @codex-web/web build
pnpm --filter @codex-web/api dev
```

The current API package does not yet provide a dedicated production start script. If deploying outside development, add a production entrypoint or run the compiled/tsx API process under a supervisor such as systemd, pm2, Docker, or the platform's process manager.

### Rust API Docker Deployment

The Rust API can be deployed with `Dockerfile-rs`. The image builds the web frontend first, embeds `apps/web/dist` into the Rust binary, runs Nginx on `5173`, and proxies all requests to the Rust API on `127.0.0.1:8787` inside the container. The runtime image does not need a separate frontend `dist` directory.

Build the Rust image:

```bash
docker build -f Dockerfile-rs -t codex-web-rs .
```

Run the container:

```bash
docker run -d --name codex-web-rs \
  -p 5173:5173 \
  -v codex-web-rs-data:/app/data \
  -v codex-web-codex-home:/root/.codex \
  codex-web-rs
```

Rust runtime data is stored under `/app/data` via:

```text
CODEX_WEB_DATA_DIR=/app/data
```

Codex CLI keeps its default home at `/root/.codex`; mount it if you want CLI auth/configuration to survive container recreation.

The Rust image also includes `rclone` and the same sync helper. For Rust deployments the startup script can restore `/app/data` before the API starts:

```bash
docker run -d --name codex-web-rs \
  -p 5173:5173 \
  -v codex-web-rs-data:/app/data \
  -v codex-web-codex-home:/root/.codex \
  -e REMOTE_FOLDER=remote:codex-web-backup \
  -e CODEX_WEB_RESTORE_ON_START=1 \
  codex-web-rs
```

With `CODEX_WEB_RESTORE_ON_START=1`, `/app/data` is restored from `REMOTE_FOLDER/app/data` before Nginx and the Rust API start. The existing `docker/sync.sh` helper is unchanged and still defaults to the TypeScript data path `/app/apps/api/data`.

## Important Environment Variables

- `HOST`: API bind host, default `0.0.0.0`
- `PORT`: API port, default `8787`
- `CODEX_WEB_ROOT`: workspace root override
- `CODEX_WEB_SESSION_ROOT`: generated session workspace root override
- `CODEX_WEB_PROJECT_ROOT`: generated project workspace root override, default `apps/api/data/projects`
- `CODEX_WEB_TERMINAL_ROOT`: terminal filesystem boundary
- `CODEX_WEB_TERMINAL_CWD`: default terminal cwd
- `CODEX_WEB_LOCAL_API_BASE_URL`: local API base URL used by provider proxy
- `CODEX_WEB_CODEX_SANDBOX`: Codex sandbox mode override
- `CODEX_WEB_CODEX_APPROVAL`: Codex approval policy override
- `CODEX_WEB_CODEX_BYPASS_SANDBOX`: bypass Codex sandbox and approvals when enabled
- `CODEX_WEB_PROVIDER_TIMEOUT_MS`: provider request timeout fallback
- `CODEX_WEB_PROVIDER_MODELS_CACHE_TTL_MS`: provider model cache TTL fallback

Most runtime settings are configured from the web UI. Environment variables are mainly fallbacks or deployment overrides.

## Git Baseline

This project is a git repository. Use normal commits as the primary checkpoint before broad changes:

```bash
git status --short
git log --oneline -5
```

Desktop ZIP backups are convenience copies only. When creating one manually, include `.git` and exclude `node_modules`, build output, and runtime data such as `apps/api/data`.
