#!/usr/bin/env bash
set -euo pipefail

export MISE_SHIMS_DIR="${MISE_SHIMS_DIR:-$HOME/.local/share/mise/shims}"
export PATH="$MISE_SHIMS_DIR:$HOME/.local/bin:$PATH"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"
export CODEX_WEB_DATA_DIR="${CODEX_WEB_DATA_DIR:-/app/data}"

mkdir -p "$CODEX_WEB_DATA_DIR" /app/restore-backups

echo -e "======================启动nginx========================\n"
nginx -s reload 2>/dev/null || nginx -c /etc/nginx/nginx.conf
echo -e "nginx启动成功...\n"

echo -e "======================启动pm2服务========================\n"
pm2 delete "codex-web-api" >/dev/null 2>&1 || true
pm2 start "codex-web-rs" --name "codex-web-api" --time
pm2 startup || true
pm2 save || true


tail -f /dev/null

exec "$@"
