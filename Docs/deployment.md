# 部署

> 最后更新：2026-06-21

## 本地开发模式

> 前置：MySQL Docker + ppt-runner 镜像已就绪（见 [development.md](development.md#开发环境搭建) 或 [README](../README.md)）。

### 两种开发模式

#### 模式 A：一体化（推荐快速验证）

API 托管已构建的前端，单端口访问：

```bash
cd webui && npm run build && cd ..
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765
## → http://127.0.0.1:8765/
```

或使用脚本（自动检测 dist）：

```bash
bash scripts/dev-web.sh
```

**优点**：与生产行为一致，无需 proxy  
**缺点**：前端改动需重新 `npm run build`

#### 模式 B：分离 + HMR（推荐前端开发）

```bash
## 终端 1
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765 --reload

## 终端 2
cd webui && npm run dev
## → http://127.0.0.1:5173
```

Vite dev server 将 `/api/*` 代理到 `:8765`，Cookie 鉴权正常工作。

**优点**：前端热更新  
**缺点**：需两个终端

### 后端热重载

```bash
.venv/bin/uvicorn backend.main:app --reload
```

修改 `backend/` 下 Python 文件自动重启。注意：

- dispatcher/watchdog 随进程重启
- stuck job 在 lifespan 中自动清理
- 修改 Docker runner 镜像需重新 build

### 调试运行中的 Job

```bash
## 查看容器日志
docker logs -f ppt-job-<job_id>

## 查看活跃容器
docker ps --filter name=ppt-job-

## 手动停止
docker stop ppt-job-<job_id>
```

### 数据库

MySQL 8 通过 Docker 运行（与生产相同）：

```bash
docker run -d --name ppt-mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=pptweb \
  -e MYSQL_USER=pptweb \
  -e MYSQL_PASSWORD=pptweb \
  -v ppt-mysql-data:/var/lib/mysql \
  mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

`.env` 中 `DB_URL` 须与容器账号一致。生产部署见 [生产环境部署](#生产环境部署)。

### 环境变量

开发时建议至少设置：

```bash
DB_URL=mysql+pymysql://pptweb:pptweb@127.0.0.1:3306/pptweb?charset=utf8mb4
PPT_WEB_JWT_SECRET=$(openssl rand -hex 32)
ANTHROPIC_AUTH_TOKEN=sk-...
```

完整列表见 [reference.md](reference.md#环境变量参考)。

### 相关文档

- [development.md](development.md#开发环境搭建)
- [development.md](development.md#前端开发指南)

---

## 生产环境部署

> 相关代码：[`README.md`](../README.md)

当前仓库**未提供** docker-compose 或 CI/CD 配置，以下为手动部署 checklist。

### 部署架构

```
                    ┌─────────────────┐
  用户浏览器 ──────►│  Nginx / Caddy   │ (可选反向代理 + TLS)
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  uvicorn         │
                    │  backend.main    │
                    │  + webui/dist    │
                    └────────┬────────┘
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼─────┐
       │ MySQL 8     │ │ data/     │ │ Docker    │
       │ (DB_URL)    │ │ 本地磁盘   │ │ daemon    │
       └─────────────┘ └───────────┘ └───────────┘
                                              │
                                    ppt-runner 容器池
```

### 部署 Checklist

#### 1. 服务器准备

- [ ] Linux 服务器（推荐 Ubuntu 22.04+）
- [ ] Python 3.11、Node.js 18+、Docker、git
- [ ] 至少 8GB RAM（并发 3 job × 4GB = 12GB 推荐）
- [ ] 50GB+ 磁盘（Docker 镜像 + 用户数据）

#### 2. 启动 MySQL（Docker）

```bash
docker run -d --name ppt-mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=<root-pwd> \
  -e MYSQL_DATABASE=pptweb \
  -e MYSQL_USER=pptweb \
  -e MYSQL_PASSWORD=<pwd> \
  -v ppt-mysql-data:/var/lib/mysql \
  mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

⚠️ 库字符集必须是 **utf8mb4**（非 utf8），否则 emoji 会被截断。

#### 3. 构建 ppt-runner 镜像与网桥

```bash
bash docker/ppt-runner/build.sh
```

#### 4. 克隆与构建应用

```bash
git clone --recursive <repo-url>
cd ppt-web

python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

cd webui && npm ci && npm run build && cd ..
```

#### 5. 环境变量

```bash
cp .env.example .env
```

**必须设置**：

```bash
PPT_WEB_JWT_SECRET=<openssl rand -hex 32>
DB_URL=mysql+pymysql://pptweb:<password>@127.0.0.1:3306/pptweb?charset=utf8mb4
ANTHROPIC_AUTH_TOKEN=sk-...
MAX_CONCURRENT_JOBS=3
DOCKER_RUNNER_MEMORY=4g
DOCKER_RUNNER_CPUS=2
DOCKER_RUNNER_TIMEOUT_S=1800
```

#### 6. 启动服务

```bash
.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8765
```

生产建议用 systemd 或 supervisor 守护进程：

```ini
## /etc/systemd/system/ppt-web.service
[Unit]
Description=ppt-web API
After=network.target docker.service

[Service]
Type=simple
User=pptweb
WorkingDirectory=/opt/ppt-web
EnvironmentFile=/opt/ppt-web/.env
ExecStart=/opt/ppt-web/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765
Restart=always

[Install]
WantedBy=multi-user.target
```

#### 7. 反向代理（推荐）

Nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name ppt.example.com;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE 需要
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
```

#### 8. 安全加固

- [ ] **立即修改默认 admin 密码**（admin/admin）
- [ ] 设置固定 `PPT_WEB_JWT_SECRET`
- [ ] API key 仅通过 Admin 或 `.env` 配置，不下发前端
- [ ] `data/` 目录权限限制（仅 pptweb 用户可读）
- [ ] 防火墙：仅暴露 443，不暴露 8765/3306
- [ ] 定期备份 MySQL 和 `data/users/`

#### 9. 验证

```bash
curl https://ppt.example.com/api/health
## 注册 → 创建任务 → 观察 SSE → 下载 pptx
```

### 扩容考虑

| 瓶颈 | 方案 |
|------|------|
| 单进程 dispatcher | 当前架构单 uvicorn 实例；多实例需共享 DB + 分布式锁（未实现） |
| 磁盘空间 | 定期清理旧 job 数据；未来迁移 S3 |
| 并发 job 数 | 调 `MAX_CONCURRENT_JOBS` + 服务器 RAM |
| API 自身容器化 | 可自行写 Dockerfile 包装 uvicorn |

### 相关文档

- [docker-runner.md](deployment.md#docker-runner-镜像)
- [environment-variables.md](reference.md#环境变量参考)

---

## Docker Runner 镜像

> 相关代码：[`docker/ppt-runner/`](../docker/ppt-runner/)

### 概述

ppt-web 的每个 PPT 生成任务在**独立 Docker 容器**中执行。这是唯一的执行方式——backend 不会直接在宿主机调用 claude。

### 构建

```bash
bash docker/ppt-runner/build.sh
```

脚本会：

1. `docker build` 产出 `ppt-runner:latest`（约 1.5GB，首次 5–10 分钟）
2. 创建 `ppt-isolated` bridge 网络（若不存在）

### 镜像内容

[`docker/ppt-runner/Dockerfile`](../docker/ppt-runner/Dockerfile)：

| 组件 | 说明 |
|------|------|
| Python 3.11 | ppt-master 脚本运行时 |
| Node.js | claude CLI 依赖 |
| claude CLI | Anthropic Claude Code headless |
| ppt-master 源码 | 从构建上下文 COPY |
| pip 依赖 | ppt-master requirements |
| 字体 | 中英文字体（CJK SVG/PPTX 渲染） |

### 容器运行参数

backend 通过 [`backend/runner/docker.py`](../backend/runner/docker.py) 构建命令：

```bash
docker run --rm -i \
  --name ppt-job-<job_id> \
  -v <data/users/<uid>/>:/work \
  -e PROMPT="..." \
  -e JOB_ID="<job_id>" \
  -e RESUME_SESSION_ID="..." \    # resume 时
  -e ANTHROPIC_AUTH_TOKEN="..." \
  -e ANTHROPIC_MODEL="..." \
  --memory=<DOCKER_RUNNER_MEMORY> \
  --cpus=<DOCKER_RUNNER_CPUS> \
  --network=<DOCKER_RUNNER_NETWORK> \
  ppt-runner:latest
```

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DOCKER_RUNNER_IMAGE` | `ppt-runner:latest` | 镜像名 |
| `DOCKER_RUNNER_NETWORK` | `ppt-isolated` | bridge 网络 |
| `DOCKER_RUNNER_MEMORY` | `4g` | 内存上限 |
| `DOCKER_RUNNER_CPUS` | `2` | CPU 份额 |
| `DOCKER_RUNNER_TIMEOUT_S` | `1800` | 超时秒数，超时 docker kill |

Admin UI 可覆盖部分参数，修改后仅对新 job 生效。

### 网络隔离

`ppt-isolated` bridge 网络使每个容器有独立 netns：

- ppt-master 子脚本硬编码端口问题自动消失
- 容器间不可互访
- 生图步骤需要外网时，容器仍可访问（bridge 默认 NAT）

### 挂载目录

宿主机 `data/users/<uid>/` 挂载到容器 `/work`：

```
/work/
├── uploads/<job_id>/     ← 用户上传
└── projects/<job_id>/    ← agent 工作目录
    └── <name>_ppt169_<date>/
        ├── svg_output/
        └── exports/*.pptx
```

### 生命周期

1. dispatcher 取 queued job → `docker run`
2. entrypoint 执行 `claude --print` → 驱动 ppt-master
3. stream-json 输出被 backend 解析 → SSE 推送
4. claude 退出或超时 → 容器 `--rm` 自动销毁
5. cancel 时 backend 调用 `docker stop ppt-job-<id>`

### 故障排查

| 症状 | 检查 |
|------|------|
| `Docker image not found` | 运行 `build.sh` |
| `Docker daemon not available` | `docker info` |
| 容器 OOM killed | 增大 `DOCKER_RUNNER_MEMORY` |
| 超时 | 增大 `DOCKER_RUNNER_TIMEOUT_S` 或检查模型响应 |
| 中文乱码 | 确认镜像含 CJK 字体 |

```bash
## 查看最近容器日志
docker ps -a --filter name=ppt-job- --format '{{.Names}}' | head -1 | xargs docker logs
```

### 升级 ppt-master

ppt-master 是 submodule，升级后需**重新 build 镜像**：

```bash
cd ppt-master && git pull && cd ..
git add ppt-master && git commit -m "chore: bump ppt-master"
bash docker/ppt-runner/build.sh
```

### 相关文档

- [architecture/execution-pipeline.md](architecture.md#任务执行流水线)
- [design/security-sandbox.md](design.md#安全沙箱与多租户隔离)
---

## 相关文档

- [README.md](README.md) — 文档导航
- [product.md](product.md) — 产品
- [architecture.md](architecture.md) — 架构
- [design.md](design.md) — 设计（详细；根目录 [DESIGN.md](../DESIGN.md) 为摘要索引）
- [development.md](development.md) — 开发
- [deployment.md](deployment.md) — 部署
- [reference.md](reference.md) — 参考
