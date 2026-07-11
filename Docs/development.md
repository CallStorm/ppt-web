# 开发

> 最后更新：2026-06-21  
> 相关代码：[`README.md`](../README.md)、[`backend/requirements.txt`](../backend/requirements.txt)、[`webui/package.json`](../webui/package.json)

完整快速开始见 [README.md](../README.md)。以下为开发环境要点，**按顺序**执行。

## 开发环境搭建

### 前置要求

| 依赖 | 版本建议 | 用途 |
|------|----------|------|
| Docker | 最新稳定版 | MySQL 容器 + 每 job 执行容器（**必需**） |
| Python | 3.11+ | 后端 |
| Node.js | 18+ | 前端构建 |
| git | — | clone 仓库与 ppt-master |

### 1. 启动 MySQL（Docker）

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

已存在容器时用 `docker start ppt-mysql` 重启。库字符集必须是 **utf8mb4**。

### 2. 构建 ppt-runner 镜像与网桥

```bash
bash docker/ppt-runner/build.sh
# 首次约 5–10 分钟，产出 ppt-runner:latest + ppt-isolated 网络
```

### 3. 克隆仓库

```bash
git clone <repo-url>
cd ppt-web
```

### 4. 准备 ppt-master（本地开发）

后端模板 API 与 runner 依赖仓库根目录下的 `ppt-master/`：

```bash
bash scripts/ensure-ppt-master.sh
```

`dev-web.sh` 启动前也会自动执行此脚本。Docker 镜像构建时会在 `build.sh` 内 clone 上游，无需本地目录。

### 5. Python 环境 + 配置 .env

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

cp .env.example .env
# 编辑：DB_URL、PPT_WEB_JWT_SECRET、ANTHROPIC_AUTH_TOKEN
```

`.env.example` 已预填 MySQL `DB_URL`，与步骤 1 的 Docker 账号一致。

### 6. 构建前端

```bash
cd webui && npm install && npm run build && cd ..
```

### 7. 启动服务

```bash
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765
# 或：bash scripts/dev-web.sh
```

**分离模式（HMR）**：见 [deployment.md](deployment.md#本地开发模式)。

### 8. 验证

1. 浏览器打开 `http://127.0.0.1:8765/`，注册并登录
2. `curl http://127.0.0.1:8765/api/health`
3. smoke test：`.venv/bin/python backend/scripts/smoke.py "写一份 4 页 Python 简介 PPT"`

### 常见问题

| 问题 | 解决 |
|------|------|
| 无法连接数据库 | 确认 `docker ps` 中 ppt-mysql 在运行；检查 `.env` 中 `DB_URL` |
| `Docker image not found` | 运行 `bash docker/ppt-runner/build.sh` |
| `ppt-master/` 缺失 | `bash scripts/ensure-ppt-master.sh` |
| 登录态重启后失效 | 设置 `PPT_WEB_JWT_SECRET` |
| 前端 404 | 先 `cd webui && npm run build` |

---

> 最后更新：2026-06-21

```
ppt-web/
├── DESIGN.md              # 设计摘要与实现状态索引
├── README.md              # 快速开始
├── Docs/                  # 完整文档（product/architecture/design/development/deployment/reference）
├── .env.example           # 环境变量模板
├── phase0/                # CLI 调试壳（Phase 0 验证）
│   ├── orchestrator.py    # 命令行编排，复用 backend.runner
│   ├── fix_preview_fonts.py
│   ├── README.md
│   └── REPORT.md          # 技术验证报告
│
├── backend/               # FastAPI 后端
│   ├── main.py            # 应用入口 (backend.main:app)
│   ├── config.py          # 运行时配置读取
│   ├── bootstrap.py       # 默认 admin 种子
│   ├── paths.py           # 数据目录路径工具
│   ├── requirements.txt
│   │
│   ├── api/               # REST API
│   │   ├── router.py      # 路由聚合
│   │   ├── deps.py        # 公共依赖
│   │   ├── routes/
│   │   │   ├── auth.py    # 注册/登录
│   │   │   ├── jobs.py    # 任务 CRUD + SSE
│   │   │   ├── health.py
│   │   │   └── spa.py     # 静态 SPA 托管
│   │   └── schemas/       # Pydantic 模型
│   │
│   ├── auth/              # JWT + 密码哈希
│   ├── admin/             # 管理后台 API
│   ├── db/                # SQLAlchemy session + 迁移
│   ├── models/            # ORM 模型
│   ├── runtime/           # dispatcher, queue, events, watchdog
│   ├── runner/            # claude CLI + docker + stages
│   └── scripts/
│       └── smoke.py       # 端到端测试
│
├── webui/                 # React 前端
│   ├── src/
│   │   ├── pages/         # Login, Dashboard, NewJob, JobDetail, Admin
│   │   ├── components/    # UI 组件
│   │   ├── hooks/         # SSE、API hooks
│   │   ├── stores/        # Zustand auth store
│   │   ├── api/           # API client
│   │   └── router.tsx     # 路由定义
│   ├── package.json
│   └── vite.config.ts     # dev proxy → :8765
│
├── docker/
│   └── ppt-runner/        # 每 job 执行容器
│       ├── Dockerfile
│       ├── build.sh
│       └── entrypoint.sh
│
├── scripts/
│   ├── dev-web.sh              # 开发启动脚本
│   ├── ensure-ppt-master.sh    # 本地 clone 上游 ppt-master
│   └── screenshot_readme.py    # README 预览截图
│
├── data/                  # 运行时数据（gitignored）
│   └── users/<uid>/       # 上传 + 产物
│
└── ppt-master/            # 上游 clone（ensure 脚本或镜像 build 产物）
    └── skills/ppt-master/
        ├── SKILL.md       # 主流程权威
        └── scripts/       # Python 工具链
```

### 模块职责速查

| 目录 | 一句话 |
|------|--------|
| `backend/runtime/` | 任务调度、并发控制、SSE pub/sub |
| `backend/runner/` | 启动 Docker、解析 claude 输出、阶段分类 |
| `backend/admin/` | 用户/任务/配置管理 |
| `webui/src/pages/` | 五个主页面 |
| `docker/ppt-runner/` | 隔离执行环境 |
| `ppt-master/` | AI 生成逻辑（不修改本仓业务代码） |

### 运行时产物（gitignored）

| 路径 | 说明 |
|------|------|
| `data/` | 用户上传与生成产物 |
| `webui/dist/` | 前端构建产物 |
| `.venv/` | Python 虚拟环境 |

---

> 最后更新：2026-06-21  
> 相关代码：[`backend/`](../backend/)

### 技术栈

- Python 3.11
- FastAPI + Uvicorn
- SQLAlchemy 2 + Pydantic 2
- passlib/bcrypt + python-jose（JWT）
- aiofiles（异步文件 I/O）

### 启动与热重载

```bash
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765 --reload
```

`--reload` 监听 Python 文件变更，适合 backend 开发。修改 runtime/dispatcher 逻辑时注意重启后 stuck job 清理。

### 应用生命周期

[`backend/main.py`](../backend/main.py) 的 `lifespan`：

1. 执行 DB 迁移 v1→v6
2. `init_db()` + `seed_default_admin()`
3. 创建 `data/` 目录
4. `cleanup_stuck_jobs()` — 清理上次异常退出的 running job
5. `check_docker_runner_ready()` — 检查 Docker 镜像
6. 启动 `dispatcher` 和 `watchdog`
7. shutdown 时停止 dispatcher/watchdog

### 核心模块

#### runtime/ — 任务调度

| 文件 | 职责 |
|------|------|
| `dispatcher.py` | 主循环：取 queued job → 启动 runner → 更新状态 |
| `queue.py` | 内存 resume 队列 |
| `events.py` | Event 持久化 + pub/sub |
| `watchdog.py` | 超时检测 |
| `jobs.py` | stuck job 清理、cancel |
| `state.py` | 活跃 job 追踪 |

并发由 `MAX_CONCURRENT_JOBS` 和 runtime config 共同控制。

#### runner/ — 执行引擎

| 文件 | 职责 |
|------|------|
| `claude.py` | 编排 claude 调用、解析 stream-json、判定 done/paused |
| `docker.py` | 构建/启动/停止 Docker 容器 |
| `stages.py` | 阶段分类、project_dir 解析 |
| `sync.py` | 产物同步到 Job 记录 |
| `preview.py` | 封面预览图查找 |
| `constants.py` | AUTO_CONFIRM_TEXT、SKIP_EIGHT_CONFIRM_MAX |

#### admin/ — 管理 API

[`backend/admin/router.py`](../backend/admin/router.py) 提供：

- `GET /api/admin/overview` — 统计概览
- 用户 CRUD、任务管理、运行时配置读写
- 所有写操作记录 `AdminActionLog`

配置存储在 `AppConfig` 表，secrets 与 settings 分离。

### 数据库

MySQL 8，通过 `DB_URL` 连接（见 `.env.example`）：

```bash
DB_URL=mysql+pymysql://pptweb:pptweb@127.0.0.1:3306/pptweb?charset=utf8mb4
```

启动 MySQL 容器见 [开发环境搭建](#开发环境搭建) 步骤 1。库须 `utf8mb4` 字符集。

#### 添加迁移

在 [`backend/db/migrations.py`](../backend/db/migrations.py) 添加 `migrate_vN_to_vN+1()`，并在 `main.py` lifespan 中调用。

### API 文档

启动后访问：

- Swagger UI：`http://127.0.0.1:8765/docs`
- OpenAPI JSON：`http://127.0.0.1:8765/openapi.json`

### 测试

```bash
## 端到端 smoke（需要 Docker + Claude API）
.venv/bin/python backend/scripts/smoke.py "你的 prompt"

## 健康检查
curl http://127.0.0.1:8765/api/health
```

### 开发注意事项

1. **Job 创建必须扣 quota**，失败路径要 refund
2. **文件路径** 使用 `paths.py` 工具，校验 `is_under()`
3. **SSE 事件** 通过 `events.py` 写入 DB 并 pub/sub，保证 seq 单调
4. **Docker 是唯一执行方式**，本地不会直接调 claude
5. 修改 runner 常量后需重启 uvicorn

### 相关文档

- [architecture/execution-pipeline.md](architecture.md#任务执行流水线)
- [architecture/data-model.md](architecture.md#数据模型与文件布局)
- [reference/api-overview.md](reference.md#api-端点摘要)

---

> 最后更新：2026-06-21  
> 相关代码：[`webui/`](../webui/)

### 技术栈

| 库 | 版本 | 用途 |
|----|------|------|
| React | 19 | UI 框架 |
| TypeScript | — | 类型安全 |
| Vite | 8 | 构建与 dev server |
| Tailwind CSS | 4 | 样式 |
| React Router | 7 | 路由 |
| TanStack Query | — | 服务端状态 |
| Zustand | — | 客户端状态（auth） |

### 开发模式

双终端启动（HMR）：

```bash
## 终端 1 — API
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765

## 终端 2 — 前端
cd webui && npm run dev
## 打开 http://127.0.0.1:5173
```

[`webui/vite.config.ts`](../webui/vite.config.ts) 将 `/api` 代理到 `http://127.0.0.1:8765`。

### 路由

[`webui/src/router.tsx`](../webui/src/router.tsx)：

| 路径 | 页面 | 鉴权 |
|------|------|------|
| `/login` | LoginPage | 公开 |
| `/` | DashboardPage | 需登录 |
| `/jobs/new` | NewJobPage | 需登录 |
| `/jobs/:id` | JobDetailPage | 需登录 |
| `/admin` | AdminPage | 需登录（admin 角色） |

`RequireAuth` 包装器检查 `authStore.me`，未登录跳转 `/login`。

### 目录结构

```
webui/src/
├── main.tsx           # 入口
├── router.tsx         # 路由
├── pages/             # 页面组件
├── components/
│   └── layout/        # AppShell 等布局
├── hooks/             # useJobEvents (SSE) 等
├── stores/
│   └── authStore.ts   # 登录态
└── api/               # fetch 封装
```

### SSE 消费

JobDetailPage 通过 `GET /api/jobs/{id}/events` 订阅进度：

- 使用 `EventSource` 或自定义 hook
- 支持 `Last-Event-ID` 断线续传
- 事件类型：`stage`、`page`、`text`、`paused`、`pptx`、`done`、`error`

详见 [architecture/progress-events.md](architecture.md#进度事件与阶段映射)。

### 构建与部署

```bash
cd webui
npm install
npm run build   # 产出 dist/
```

FastAPI 从 `webui/dist/` 托管静态文件。生产部署前必须 build。

### 环境变量

前端 build 时可设置：

```bash
VITE_DISPLAY_TIMEZONE=Asia/Shanghai
```

默认时区 `Asia/Shanghai`，与后端 `DISPLAY_TIMEZONE` 一致。

### 添加新页面

1. 在 `src/pages/` 创建组件
2. 在 `router.tsx` 注册 Route
3. 如需 API，在 `src/api/` 添加 fetch 函数
4. 列表/详情类页面优先用 TanStack Query

### 相关文档

- [deployment/local-development.md](deployment.md#本地开发模式)
- [product/user-guide.md](product.md#用户指南)

---

> 最后更新：2026-06-21  
> 相关代码：[`phase0/`](../phase0/)

Phase 0 是在 Web MVP 之前的技术验证壳，用于在命令行直接驱动 ppt-master 流水线，验证进度回流与八点确认暂停/恢复。

**验证结论**：全部通过，详见 [phase0/REPORT.md](../phase0/REPORT.md)。

### 用途

- 不启动 Web 服务，快速测试 claude + ppt-master 集成
- 调试阶段分类逻辑（与 backend 共享 `backend.runner`）
- 验证 API token 与模型配置

### 基本用法

```bash
## 新建并运行
.venv/bin/python phase0/orchestrator.py run --prompt "写一份 4 页 Python 简介 PPT"

## 恢复暂停的会话
.venv/bin/python phase0/orchestrator.py resume --confirm "确认，按推荐方案继续，页数改为 4"
```

### 与 backend 的关系

[`phase0/orchestrator.py`](../phase0/orchestrator.py) 直接 import `backend.runner` 模块，与 Web 后端共享：

- 阶段分类（`stages.py`）
- project_dir 解析
- stream-json 解析逻辑

因此 Phase 0 的调试结果可直接反映 Web 端行为。

### 验证过的能力

| 能力 | 结果 |
|------|------|
| 服务器驱动 ppt-master skill | ✅ 完整流水线 |
| 进度回流（stream-json） | ✅ 阶段 2/3/6 命中 |
| 八点确认暂停/恢复 | ✅ session resume 有效 |
| 修改 spec 后 resume | ✅ 页数从 8 改 4 生效 |
| 产出有效 pptx | ✅ 4 页原生 DrawingML |

### 已知问题（Phase 0 发现）

- ~~done-detection 误报~~ — 已修（`resolve_project_dir`）
- Read/Write 区分 — 已在 stages.py 修复
- live preview 缺 flask — Web 未集成，不影响生成
- superpowers 插件噪声 — 生产可考虑禁用

### 何时使用 CLI vs Web

| 场景 | 推荐 |
|------|------|
| 快速验证 prompt/模型 | Phase 0 CLI |
| 多用户、上传、历史 | Web |
| 调试 Docker 隔离 | Web backend + docker logs |
| 调试阶段映射 | 两者均可 |

### 相关文档

- [phase0/README.md](../phase0/README.md)
- [architecture/execution-pipeline.md](architecture.md#任务执行流水线)
---

## 相关文档

- [README.md](README.md) — 文档导航
- [product.md](product.md) — 产品
- [architecture.md](architecture.md) — 架构
- [design.md](design.md) — 设计（详细；根目录 [DESIGN.md](../DESIGN.md) 为摘要索引）
- [development.md](development.md) — 开发
- [deployment.md](deployment.md) — 部署
- [reference.md](reference.md) — 参考
