#!/usr/bin/env bash
set -euo pipefail

mkdir -p /app/apps/api/data /app/apps/api/restore-backups


echo -e "======================启动nginx========================\n"
nginx -s reload 2>/dev/null || nginx -c /etc/nginx/nginx.conf
echo -e "nginx启动成功...\n"



echo -e "======================启动pm2服务========================\n"
pm2 delete "codex-web-api" >/dev/null 2>&1 || true
pm2 start "pnpm --filter @codex-web/api dev" --name "codex-web-api" --time
pm2 startup || true
pm2 save || true


tail -f /dev/null

exec "$@"
