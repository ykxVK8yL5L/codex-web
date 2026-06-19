#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/root}"
export MISE_SHIMS_DIR="${MISE_SHIMS_DIR:-$HOME/.local/share/mise/shims}"
export MISE_BIN="${MISE_BIN:-/usr/local/bin/mise}"
export MISE_DATA_DIR="${MISE_DATA_DIR:-$HOME/.local/share/mise}"
export MISE_CONFIG_DIR="${MISE_CONFIG_DIR:-$HOME/.config/mise}"
export MISE_CACHE_DIR="${MISE_CACHE_DIR:-$HOME/.cache/mise}"
export PATH="$MISE_SHIMS_DIR:$HOME/.local/bin:/usr/local/bin:$PATH"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"
export CODEX_WEB_DATA_DIR="${CODEX_WEB_DATA_DIR:-/app/data}"

mkdir -p "$CODEX_WEB_DATA_DIR" /app/restore-backups "$MISE_DATA_DIR" "$MISE_CONFIG_DIR" "$MISE_CACHE_DIR"

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