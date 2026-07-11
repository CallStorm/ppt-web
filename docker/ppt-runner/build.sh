#!/bin/bash
# build ppt-runner 镜像 + 创建 ppt-isolated 网络
# 用法（在 ppt-web 根目录）:
#   bash docker/ppt-runner/build.sh
set -euo pipefail

IMAGE="${DOCKER_RUNNER_IMAGE:-ppt-runner:latest}"
NETWORK="${DOCKER_RUNNER_NETWORK:-ppt-isolated}"

cd "$(dirname "$0")/../.."  # 切到 repo 根（build context）

echo "==> Building $IMAGE (context: $(pwd))"
docker build -f docker/ppt-runner/Dockerfile -t "$IMAGE" \
  --build-arg BASE_REGISTRY="${DOCKER_BASE_REGISTRY:-docker.m.daocloud.io/library}" \
  --build-arg PIP_INDEX_URL="${DOCKER_PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple/}" \
  --build-arg PPT_MASTER_REPO="${PPT_MASTER_REPO:-https://github.com/hugohe3/ppt-master.git}" \
  --build-arg PPT_MASTER_REF="${PPT_MASTER_REF:-main}" \
  .

echo "==> Ensuring $NETWORK network exists"
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  docker network create --driver bridge "$NETWORK"
  echo "    created"
else
  echo "    already exists"
fi

echo ""
echo "==> Done. Test run:"
echo "    docker run --rm -i --network $NETWORK $IMAGE --version"
echo ""
echo "==> Start ppt-web (requires $IMAGE):"
echo "    bash scripts/dev-web.sh"
echo "    # or: .venv/bin/uvicorn backend.main:app"
