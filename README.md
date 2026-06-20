# ppt-web

`ppt-web` 是围绕 [ppt-master](https://github.com/) 的 web 化封装项目。ppt-master 是生成 PPT 的核心 agent + 技能系统；本项目把它包成「开箱即用」的服务，分三阶段渐进：

- **phase0** — CLI 壳，调试用（`python phase0/orchestrator.py run --prompt "..."`）
- **phase1** — FastAPI 单页 Web MVP（`/docs` 看 API 文档）
- **phase2** — 鉴权 + 多用户隔离 + multipart 上传

设计文档：[DESIGN.md](./DESIGN.md)。每个 phase 自己的 `REPORT.md` 记实现笔记。

## 快速开始

```bash
# 1. clone（含 submodule）
git clone --recursive <repo-url>
cd ppt-web

# 2. 建虚拟环境 + 装依赖
python3 -m venv .venv
.venv/bin/pip install -r phase1/requirements.txt

# 3.（可选）配 .env
cp .env.example .env
# 编辑 .env 设 DB_URL / JWT_SECRET 等

# 4. 启动 Web 服务
.venv/bin/uvicorn phase1.server:app --host 127.0.0.1 --port 8765

# 5. 浏览器打开
open http://127.0.0.1:8765/
```

第一次启动会自动跑 DB 迁移（`v1→v2→v3`）。

## 数据库

**默认 SQLite**（`./jobs.db`，零依赖，适合本地开发）。
**生产推荐 MySQL**（或 Postgres），通过 `DB_URL` 环境变量切：

```bash
# 本地起一个 MySQL 8 docker
docker run -d --name ppt-mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=pptweb \
  -e MYSQL_USER=pptweb \
  -e MYSQL_PASSWORD=pptweb \
  -v ppt-mysql-data:/var/lib/mysql \
  mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci

# 切到 MySQL 启动
DB_URL="mysql+pymysql://pptweb:pptweb@127.0.0.1:3306/pptweb?charset=utf8mb4" \
  .venv/bin/uvicorn phase1.server:app
```

支持的 URL scheme：

| 驱动 | URL 前缀 | 备注 |
|---|---|---|
| SQLite（默认） | `sqlite:///./jobs.db` | 本地零依赖 |
| MySQL | `mysql+pymysql://…` | 需 `pip install pymysql`；库字符集 `utf8mb4` |
| Postgres | `postgresql+psycopg2://…` | 需 `pip install psycopg2-binary` |

迁移（`v1→v2→v3`）和 PRAGMA（WAL）都做了 DB 类型判断，SQLite 本地开发 + MySQL 部署可以无缝切换。

## Job 隔离：每 job 一个 Docker 容器

每个生成任务在一个临时容器里跑，跑完自动销毁（`--rm`）。**这是方案 2（推荐给多用户/对外场景）**。

```bash
# 1. 一次性 build 镜像
bash docker/ppt-runner/build.sh
# 等 5-10 分钟，build 完一个 ~1.5GB 的 ppt-runner:latest 镜像

# 2. 启用 docker runner 启动
export USE_DOCKER_RUNNER=true
.venv/bin/uvicorn phase1.server:app
```

镜像里包含：`python 3.11 + claude CLI + ppt-master 源码 + ppt-master 依赖 + 中英文字体`。每 job 起一个容器，per-user 写目录 mount 进 `/work`，claude 退出或 30 分钟超时后自动销毁。

**架构**：

```
uvicorn 进程（API 层）
  └─ docker run --rm -i \
       --name ppt-job-<job_id> \
       -v data/users/<uid>/projects/<job_id>/:/work \
       -e PROMPT=... -e JOB_ID=... \
       -e ANTHROPIC_AUTH_TOKEN=... \
       --memory=4g --cpus=2 --network=ppt-isolated \
       ppt-runner:latest
```

**关掉 = 走老路**（host 上直接 Popen `claude`，cwd=`ppt-master/`，适合本地快速开发）：

```bash
# 不设 USE_DOCKER_RUNNER，或：
unset USE_DOCKER_RUNNER
.venv/bin/uvicorn phase1.server:app
```

**可调环境变量**（都列在 `.env.example`）：

| 变量 | 默认 | 含义 |
|---|---|---|
| `MAX_CONCURRENT_JOBS` | `3` | 全局最多同时跑几个生成任务；超过后返回 409 |
| `USE_DOCKER_RUNNER` | `false` | 是否走 docker |
| `DOCKER_RUNNER_IMAGE` | `ppt-runner:latest` | 镜像名 |
| `DOCKER_RUNNER_NETWORK` | `ppt-isolated` | bridge 网络（用 `build.sh` 自动建） |
| `DOCKER_RUNNER_MEMORY` | `4g` | 单 job 内存上限 |
| `DOCKER_RUNNER_CPUS` | `2` | 单 job CPU 份额 |
| `DOCKER_RUNNER_TIMEOUT_S` | `1800` | 单 job 超时（秒），超时强杀 |

> ⚠️ Docker 模式下 ppt-master 子脚本的硬编码端口问题**自动消失**（每个容器独立 netns）。

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
```

本仓的 `.gitmodules` 指向 `https://github.com/CallStorm/ppt-master.git`（fork）。

> ⚠️ **clone 时一定要带 `--recursive`**，否则 `ppt-master/` 是空目录。

## 目录结构

```
ppt-web/
├── DESIGN.md              # 整体设计稿
├── README.md              # 本文件
├── .env.example           # 环境变量示例（cp 成 .env 用）
├── .gitignore
├── phase0/                # CLI 调试壳
│   ├── orchestrator.py
│   ├── fix_preview_fonts.py
│   └── README.md
├── phase1/                # FastAPI Web MVP
│   ├── server.py          # 入口
│   ├── core.py            # agent 调用 + 流式事件 + 8 点确认已默认关闭
│   ├── auth.py / models.py / db.py / paths.py
│   ├── static/            # 前端
│   └── _smoke.py          # 不接 HTTP 的烟雾测试
├── phase2/                # 鉴权 + 多用户（部分就位）
│   └── REPORT.md
├── data/                  # 运行时用户数据（gitignored）
└── ppt-master/            # ← git submodule
```

## 跑测试

```bash
# 端到端 smoke（要 claude CLI 在 PATH，会烧 token）
.venv/bin/python phase1/_smoke.py "写一份 4 页 Python 简介 PPT"
```
