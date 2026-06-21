# ppt-web

`ppt-web` 是围绕 [ppt-master](https://github.com/) 的 web 化封装项目。ppt-master 是生成 PPT 的核心 agent + 技能系统；本项目把它包成「开箱即用」的服务：

- **phase0** — CLI 壳，调试用（`python phase0/orchestrator.py run --prompt "..."`）
- **backend + webui** — FastAPI 后端 + React 前端（含鉴权、多用户隔离、文件上传）

- 设计摘要：[DESIGN.md](./DESIGN.md)
- 完整文档：[Docs/README.md](./Docs/README.md)
- phase0 验证报告：[phase0/REPORT.md](./phase0/REPORT.md)

## 系统架构

![ppt-web 整体架构](./images/architecture.png)

> 可编辑源文件：[Docs/architecture/ppt-web-architecture.drawio](./Docs/architecture/ppt-web-architecture.drawio)（draw.io / diagrams.net）

## 界面预览

### 作品列表

![作品列表](./images/list.png)

登录后的主页，以卡片形式展示已生成的 PPT，支持搜索和按状态筛选（运行中 / 完成 / 失败）。顶部可进入「创建」与「管理后台」。

### 创建任务

![创建任务](./images/new.png)

填写项目名称、上传参考素材（PDF / DOCX / PPTX 等）、内容描述；可选语言、场景、受众、语调、页数，提交后启动 agent 生成。

### 任务详情

![任务详情](./images/detail.png)

点击作品进入详情页，查看任务状态、费用、生成选项；通过 Tab 切换概览、原始输出、时间线、产物；可下载 `.pptx`，底部展示 Agent 各阶段执行进度。

### 管理后台

![管理后台](./images/admin.png)

管理员专用（`#/admin`），含概览、用户、任务、设置四个 Tab。设置页可配置并发上限、Docker runner 参数，以及 Claude / Cloud 所需的 `ANTHROPIC_*` 模型与 API 信息；用户与任务管理见下文 [Admin 管理后台](#admin-管理后台) 章节。

## 前置要求

| 依赖 | 版本建议 | 用途 |
|------|----------|------|
| Docker | 最新稳定版 | MySQL 容器 + 每 job 执行容器（**必需**） |
| Python | 3.11+ | 后端 API |
| Node.js | 18+ | 前端构建 |
| git | — | clone 含 submodule |

## 快速开始

按顺序执行以下步骤。基础设施（MySQL、ppt-runner 镜像）必须先就绪，再启动应用。

### 1. 启动 MySQL（Docker）

```bash
# 首次创建（已存在则跳过，用 docker start ppt-mysql 重启）
docker run -d --name ppt-mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=pptweb \
  -e MYSQL_USER=pptweb \
  -e MYSQL_PASSWORD=pptweb \
  -v ppt-mysql-data:/var/lib/mysql \
  mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

库字符集必须是 **utf8mb4**（不是 utf8，否则 emoji 会被截断）。

验证 MySQL 已就绪：

```bash
docker ps --filter name=ppt-mysql
# 或：docker exec ppt-mysql mysqladmin ping -h localhost -u root -proot
```

### 2. 构建 ppt-runner 镜像与网桥

每个 PPT 生成任务在独立 Docker 容器内执行，**必须先 build 镜像**（同时创建 `ppt-isolated` bridge 网络）：

```bash
bash docker/ppt-runner/build.sh
# 首次约 5–10 分钟，产出 ppt-runner:latest（~1.5GB）
```

### 3. 克隆仓库

```bash
git clone --recursive <repo-url>
cd ppt-web
```

> ⚠️ **必须带 `--recursive`**，否则 `ppt-master/` 是空目录。

若已 clone 未初始化 submodule：

```bash
git submodule update --init --recursive
```

### 4. Python 环境 + 配置 .env

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

cp .env.example .env
```

编辑 `.env`，至少填写：

```bash
DB_URL=mysql+pymysql://pptweb:pptweb@127.0.0.1:3306/pptweb?charset=utf8mb4
PPT_WEB_JWT_SECRET=$(openssl rand -hex 32)
# Claude API（也可在 Admin 后台配置）
ANTHROPIC_AUTH_TOKEN=sk-...
```

### 5. 构建前端

```bash
cd webui && npm install && npm run build && cd ..
```

产物在 `webui/dist/`，由 FastAPI 托管。

### 6. 启动服务

```bash
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765
```

或使用便捷脚本（自动检测 dist 是否存在）：

```bash
bash scripts/dev-web.sh
```

第一次启动会自动跑 DB 迁移（`v1→v6`）。

### 7. 验证

```bash
open http://127.0.0.1:8765/
curl http://127.0.0.1:8765/api/health
```

注册账号并登录。默认管理员：**admin / admin**（生产环境请立即改密）。

**前端开发（HMR）：** 后端与前端分两个终端跑，Vite 会把 `/api` 代理到 `:8765`：

```bash
# 终端 1 — API
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765

# 终端 2 — 前端热更新
cd webui && npm run dev
# 打开 http://127.0.0.1:5173
```

## Job 隔离：每 job 一个 Docker 容器

每个生成任务在临时容器里跑，跑完自动销毁（`--rm`）。镜像与网桥在快速开始步骤 2 已构建。

镜像里包含：`python 3.11 + claude CLI + ppt-master 源码 + ppt-master 依赖 + 中英文字体`。每 job 起一个容器，per-user 写目录 mount 进 `/work`，claude 退出或超时后自动销毁。

**架构**：

```
uvicorn 进程（API 层）
  └─ docker run --rm -i \
       --name ppt-job-<job_id> \
       -v data/users/<uid>/:/work \
       -e PROMPT=... -e JOB_ID=... \
       -e ANTHROPIC_AUTH_TOKEN=... \
       --memory=4g --cpus=2 --network=ppt-isolated \
       ppt-runner:latest
```

**可调环境变量**（都列在 `.env.example`）：

| 变量 | 默认 | 含义 |
|---|---|---|
| `MAX_CONCURRENT_JOBS` | `3` | 全局最多同时跑几个生成任务；超过后返回 409 |
| `DOCKER_RUNNER_IMAGE` | `ppt-runner:latest` | 镜像名 |
| `DOCKER_RUNNER_NETWORK` | `ppt-isolated` | bridge 网络（`build.sh` 自动建） |
| `DOCKER_RUNNER_MEMORY` | `4g` | 单 job 内存上限 |
| `DOCKER_RUNNER_CPUS` | `2` | 单 job CPU 份额 |
| `DOCKER_RUNNER_TIMEOUT_S` | `1800` | 单 job 超时（秒），超时强杀 |

> ⚠️ Docker 模式下 ppt-master 子脚本的硬编码端口问题**自动消失**（每个容器独立 netns）。

## Admin 管理后台

首次启动会自动创建默认管理员：**账号 `admin`，密码 `admin`**（已存在则不覆盖密码）。

1. 登录后侧边栏出现「管理后台」，或直接访问 `#/admin`
2. 可在设置页配置：
   - **最大并发审核任务数 / 启动容器数上限**（1–50）
   - Docker runner（镜像、内存、CPU、超时等）
   - **Claude Code 容器环境变量**（`ANTHROPIC_*` 模型/API、Secrets、自定义 env）
   - Watchdog 参数
3. 用户管理：改 role/quota/重置密码
4. 任务管理：全站列表、取消、标记失败、手动退款

配置修改后**仅对新启动的任务/容器生效**。生产环境务必第一时间修改默认 admin 密码。

Admin API 文档：`/docs` → `admin` tag（需 admin 角色 cookie）。

界面示意见上文 [管理后台](#管理后台)。

## 鉴权密钥

开发/生产都建议固定 JWT secret，否则服务一重启登录态就会失效：

```bash
openssl rand -hex 32
# 把输出写入 .env：
PPT_WEB_JWT_SECRET=<上一步输出>
```

## 生成行为

每次创建任务，agent 会**直接采用 ppt-master 的推荐默认值**（画布/页数/风格/配色等）一气呵成跑完所有步骤直到导出 pptx。

- 不会再弹「八点确认」面板
- 如果中途需要调整，改 prompt 里的描述重新创建任务即可

如果你需要中途停一下让 agent 问几个问题，可以自己加 prompt 指令（例如「在选定风格前先问我两个问题」），agent 会遵守 prompt 而不是写死的系统行为。

## ppt-master 是 submodule

`ppt-master/` 目录是 git submodule，源码独立版本管理，方便升级不污染本仓。

```bash
# 升级 ppt-master
cd ppt-master
git pull origin main
cd ..
git add ppt-master
git commit -m "chore: bump ppt-master to <version>"
# 升级后需重新 build runner 镜像：
bash docker/ppt-runner/build.sh
```

本仓的 `.gitmodules` 指向 `https://github.com/CallStorm/ppt-master.git`（fork）。

## 目录结构

```
ppt-web/
├── DESIGN.md              # 设计摘要与实现状态索引
├── Docs/                  # 完整文档（product/architecture/design/development/deployment/reference）
│   └── architecture/      # 架构图源文件（ppt-web-architecture.drawio）
├── images/                # README 截图与架构图（architecture.png）
├── README.md              # 本文件
├── .env.example           # 环境变量示例（cp 成 .env 用）
├── .gitignore
├── phase0/                # CLI 调试壳
│   ├── orchestrator.py
│   ├── fix_preview_fonts.py
│   └── README.md
├── backend/               # FastAPI 后端（启动：backend.main:app）
│   ├── main.py            # 应用入口
│   ├── api/routes/        # auth, jobs, health, spa
│   ├── auth/              # JWT, passwords
│   ├── db/                # migrations, session
│   ├── models/
│   ├── runtime/           # dispatcher, queue, SSE, watchdog
│   ├── runner/            # claude, docker, sync, preview
│   └── scripts/smoke.py
├── webui/                 # React 前端
│   ├── src/pages/
│   ├── src/components/
│   ├── src/hooks/
│   └── src/api/
├── docker/ppt-runner/
├── data/                  # 运行时用户数据（gitignored）
└── ppt-master/            # ← git submodule
```

## 跑测试

```bash
# 端到端 smoke（需要 Docker + Claude API，会烧 token）
.venv/bin/python backend/scripts/smoke.py "写一份 4 页 Python 简介 PPT"
```

## 文档

| 文档 | 说明 |
|------|------|
| [Docs/README.md](./Docs/README.md) | 文档导航 |
| [DESIGN.md](./DESIGN.md) | 设计摘要与实现状态 |
| [Docs/product.md](./Docs/product.md) | 产品 |
| [Docs/architecture.md](./Docs/architecture.md) | 架构 |
| [Docs/design.md](./Docs/design.md) | 设计（详细） |
| [Docs/development.md](./Docs/development.md) | 开发 |
| [Docs/deployment.md](./Docs/deployment.md) | 部署 |
| [Docs/reference.md](./Docs/reference.md) | 参考 |
