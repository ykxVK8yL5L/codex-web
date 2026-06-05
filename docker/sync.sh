#!/usr/bin/env sh
set -eu

# REMOTE_FOLDER example: remote:codex-web-backup
# The remote layout preserves local absolute paths under REMOTE_FOLDER:
#   /app/apps/api/data -> ${REMOTE_FOLDER}/app/apps/api/data

BACKUP_PATHS="
/app/apps/api/data
"

require_remote_folder() {
  if [ -z "${REMOTE_FOLDER:-}" ]; then
    echo "REMOTE_FOLDER is required, for example: REMOTE_FOLDER=remote:codex-web-backup" >&2
    exit 1
  fi
}

remote_path_for() {
  local_path="$1"
  printf "%s%s" "${REMOTE_FOLDER%/}" "$local_path"
}

backup() {
  require_remote_folder
  command -v rclone >/dev/null 2>&1 || {
    echo "rclone is required" >&2
    exit 1
  }

  for local_path in $BACKUP_PATHS; do
    if [ ! -e "$local_path" ]; then
      echo "skip missing path: $local_path"
      continue
    fi
    remote_path="$(remote_path_for "$local_path")"
    echo "backup: $local_path -> $remote_path"
    rclone copy "$local_path" "$remote_path" --create-empty-src-dirs
  done
}

restore() {
  require_remote_folder
  command -v rclone >/dev/null 2>&1 || {
    echo "rclone is required" >&2
    exit 1
  }

  for local_path in $BACKUP_PATHS; do
    remote_path="$(remote_path_for "$local_path")"
    echo "restore: $remote_path -> $local_path"
    mkdir -p "$local_path"
    rclone copy "$remote_path" "$local_path" --create-empty-src-dirs
  done
}

case "${1:-}" in
  backup)
    backup
    ;;
  restore)
    restore
    ;;
  *)
    echo "Usage: REMOTE_FOLDER=remote:path $0 {backup|restore}" >&2
    exit 2
    ;;
esac
