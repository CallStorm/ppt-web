#!/usr/bin/env bash
# Ensure ppt-master/ exists for local API + template catalog (clone upstream if missing).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PPT_MASTER_REPO="${PPT_MASTER_REPO:-https://github.com/hugohe3/ppt-master.git}"
PPT_MASTER_REF="${PPT_MASTER_REF:-main}"
TARGET="$ROOT/ppt-master"

if [[ -d "$TARGET/skills/ppt-master" ]]; then
  exit 0
fi

echo "ppt-master/ not found — cloning ${PPT_MASTER_REPO} (${PPT_MASTER_REF})…"
git clone --depth 1 --branch "$PPT_MASTER_REF" "$PPT_MASTER_REPO" "$TARGET"
