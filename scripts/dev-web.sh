#!/usr/bin/env bash
# 启动 ppt-web：若 webui/dist 不存在则先 build，再拉起 uvicorn。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ ! -f webui/dist/index.html ]]; then
  echo "webui/dist not found — building frontend…"
  (cd webui && npm install && npm run build)
fi

if [[ ! -d .venv ]]; then
  echo "error: .venv not found. Run: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"
  exit 1
fi

IMAGE="${DOCKER_RUNNER_IMAGE:-ppt-runner:latest}"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "warning: Docker image $IMAGE not found."
  echo "  Build it first: bash docker/ppt-runner/build.sh"
fi

echo "Starting server at http://127.0.0.1:8765/"
exec .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765
