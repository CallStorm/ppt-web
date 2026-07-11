# ppt-runner: 每 job 临时容器跑的镜像
# 包含 python + claude CLI + ppt-master 源码 + ppt-master 依赖
# build:
#   bash docker/ppt-runner/build.sh
#   或手动：
#     docker build -f docker/ppt-runner/Dockerfile -t ppt-runner:latest .
# run (uvicorn 内部用):
#   docker run --rm -i \
#     -v <project_root>:/work \
#     -e JOB_ID=... -e PROMPT=... -e ANTHROPIC_AUTH_TOKEN=... \
#     --memory=4g --cpus=2 --network=ppt-isolated \
#     ppt-runner:latest

# 基础镜像源。国内部署可换：
#   docker build --build-arg BASE_REGISTRY=registry.cn-hangzhou.aliyuncs.com/library -t ppt-runner .
#   docker build --build-arg BASE_REGISTRY=docker.m.daocloud.io/library -t ppt-runner .
ARG BASE_REGISTRY=docker.m.daocloud.io/library
FROM ${BASE_REGISTRY}/python:3.11-slim

# 1. 系统依赖：Node（装 claude CLI 用）+ Python 系统包（CairoSVG / Pillow / PDF / 字体）
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
    nodejs npm \
    git \
    # cairosvg / Pillow 系统库
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
    # PDF / DOCX 处理
    poppler-utils \
    # 中英文字体（SVG 渲染必需）
    fonts-noto-cjk fonts-noto-cjk-extra fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# 2. 装 claude CLI（走官方安装脚本，默认装到 /root/.local/bin/claude）
#    用 bash 显式调用：Debian 的 /bin/sh 是 dash，不支持 bash 扩展
#    装到临时目录，最后 chown 给 claude 用户（不能直接以 root 跑 install.sh 然后切用户）
RUN curl -fsSL https://claude.ai/install.sh | bash

# 3. 从上游 clone ppt-master（不再依赖本地 submodule / COPY）
ARG PPT_MASTER_REPO=https://github.com/hugohe3/ppt-master.git
ARG PPT_MASTER_REF=main
RUN git clone --depth 1 --branch "${PPT_MASTER_REF}" "${PPT_MASTER_REPO}" /opt/ppt-master

# 4. 装 ppt-master 依赖（pip 用国内源加速）
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
RUN pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" \
    python-pptx>=0.6.21 \
    edge-tts>=7.2.8 \
    cairosvg>=2.7 \
    Pillow>=10.0 \
    requests>=2.31 \
    flask>=3.0 \
    flask-cors>=4.0 \
    watchdog>=4.0 \
    beautifulsoup4>=4.12 \
    lxml>=5.0 \
    pandas>=2.0 \
    openpyxl>=3.1 \
    python-docx>=1.1 \
    pypdf>=4.0

# 5. 装 entrypoint
COPY docker/ppt-runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 6. claude CLI 拒绝 root 跑。加个非 root 用户（uid 1000 跟 host 用户对齐权限）。
#    把装好的 /root/.local 移到 claude 用户家目录，并重写所有指向 /root 的 symlink。
RUN useradd --create-home --uid 1000 --shell /bin/bash claude \
    && mkdir -p /home/claude/.local \
    && cp -r /root/.local/share /home/claude/.local/ \
    && cp -r /root/.local/bin /home/claude/.local/ \
    && chown -R claude:claude /home/claude/.local \
    && rm -rf /root/.local \
    # symlink target 重写 /root → /home/claude
    && find /home/claude/.local/bin -type l -exec sh -c 'target=$(readlink "$1"); case "$target" in /root/*) ln -sf "/home/claude${target#/root}" "$1";; esac' _ {} \;
ENV PATH="/home/claude/.local/bin:${PATH}"

# /work 是 per-user project root 挂载点
WORKDIR /opt/ppt-master
USER claude
ENTRYPOINT ["/entrypoint.sh"]

# 健康检查：claude --version 确认 CLI 装好
HEALTHCHECK NONE
