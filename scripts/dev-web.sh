#!/usr/bin/env bash
# 启动 ppt-web：若 webui/dist 不存在则先 build，再拉起 uvicorn。
#
# 本地开发推荐：
#   1. bash scripts/dev-web.sh          → API + 静态 dist，http://127.0.0.1:8765
#   2. cd webui && npm run dev          → Vite 热更新，http://127.0.0.1:5173（/api 代理到 8765）
# 切勿将 Vite 绑定到 8765，会与 uvicorn 端口冲突导致筛选/API 请求失败。
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

bash scripts/ensure-ppt-master.sh

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
