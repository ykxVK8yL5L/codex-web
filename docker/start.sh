#!/usr/bin/env bash
set -euo pipefail

mkdir -p /app/apps/api/data /app/apps/api/restore-backups

pnpm --filter @codex-web/api dev &
api_pid=$!

nginx -g "daemon off;" &
nginx_pid=$!

shutdown() {
  kill "$api_pid" "$nginx_pid" 2>/dev/null || true
  wait "$api_pid" "$nginx_pid" 2>/dev/null || true
}

trap shutdown INT TERM

wait -n "$api_pid" "$nginx_pid"
exit_code=$?
shutdown
exit "$exit_code"
