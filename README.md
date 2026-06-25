# ppt-web

`ppt-web` 是围绕 [ppt-master](https://github.com/) 的 web 化封装项目。ppt-master 是生成 PPT 的核心 agent + 技能系统；本项目把它包成「开箱即用」的服务：

- **phase0** — CLI 壳，调试用（`python phase0/orchestrator.py run --prompt "..."`）
- **backend + webui** — FastAPI 后端 + React 前端（含鉴权、多用户隔离、文件上传）

**项目定位**：本项目是个人探索实验，重点是探索如何以可管控的方式利用 Claude Code 的 agent 能力：以 Docker 隔离每个 PPT 生成任务、运行后自毁，在保护宿主与用户隐私的前提下交付可下载的产物。

- 设计摘要：[DESIGN.md](./DESIGN.md)
- 完整文档：[Docs/README.md](./Docs/README.md)
- phase0 验证报告：[phase0/REPORT.md](./phase0/REPORT.md)

## 系统架构

![ppt-web 整体架构](./images/architecture.png)

> 可编辑源文件：[Docs/architecture/ppt-web-architecture.drawio](./Docs/architecture/ppt-web-architecture.drawio)（draw.io / diagrams.net）

## 示例作品

以下 4 个 PPT 由本项目（`ppt-web` + `ppt-master`）端到端自动生成，涵盖技术分享、产品介绍、协议讲解等不同场景。点击文件名即可下载到本地，用 PowerPoint / Keynote / WPS 打开查看效果。

| 示例 | 主题 | 文件 |
|------|------|------|
| 1 | 产品介绍 — 智能硬件 | [AI语音闹钟.pptx](./examples/AI语音闹钟.pptx) |
| 2 | 技术分享 — RAG 检索增强生成 | [rag技术分享.pptx](./examples/rag技术分享.pptx) |
| 3 | 协议讲解 — 计算机网络 | [TCP_IP协议介绍.pptx](./examples/TCP_IP协议介绍.pptx) |
| 4 | 产品介绍 — 运动器材 | [漂移板介绍.pptx](./examples/漂移板介绍.pptx) |

> 所有源文件位于 [`examples/`](./examples/) 目录；如需自己跑一遍同款，在 WebUI「创建任务」里粘贴对应 prompt 即可（见 `phase0/REPORT.md` 里的成功 prompt 模板）。

## 界面预览

### 作品列表

![作品列表](./images/list.png)

登录后的主页，以卡片形式展示已生成的 PPT。顶部胶囊式状态筛选器可在「全部 / 运行中 / 完成 / 失败」之间切换，标题右侧实时显示作品总数（筛选时变为 `已显示/总数`）。搜索框按项目名 / prompt 模糊匹配。初始加载时显示 6 张 `SkeletonCard` 骨架占位，避免空白闪烁。顶部可进入「创建」与「管理后台」。

### 卡片悬停与预览

![卡片悬停](./images/hover.png)

将鼠标悬停在作品卡片上，卡片右上角会出现**预览**（眼睛）和**下载**两个快捷按钮：

- **预览**：打开全屏预览（见下图），无需进入详情页即可快速翻看每一页
- **下载**：直接下载 `.pptx` 文件，等价于详情页的「下载 PPTX」

失败的任务还会显示一行**人话化错误原因**（见 [错误文案友好化](#错误文案友好化)），并提供「重试」入口，无需进入详情页即可原地重跑。

![预览弹窗](./images/preview.png)

预览弹窗中央展示当前页大图，底部缩略图条可点击跳转；按 `Esc`、点击遮罩或右上角关闭按钮退出。无需等待详情页加载，方便在列表里快速比对多份产物。

### 创建任务

![创建任务](./images/new.png)

「创建任务」页采用**三段式可折叠 + 高级抽屉**的结构，把 14 个原本塞成一坨的生成选项拆成渐进式呈现：

| 段落 | 默认 | 包含 |
|------|------|------|
| ① 内容源 | 展开 | 项目名 · 主题输入 / 文档输入 切换 · 核心主题（必填）· ✨ **智能填充** · 章节大纲 · 重点强调 |
| ② 视觉调性 | 折叠 | 基础设置（语言/场景/受众/语调/页数）· ✨ AI 优化 · 视觉风格 chip 网格 · 配色（mode + 品牌色 + 行业） |
| ③ 素材策略 | 折叠 | ✨ AI 优化 · 图片策略（卡片网格） |
| 高级（⚙） | 折叠 | 画布 · 叙事模式 · 图标策略 · 公式渲染 · 是否生成演讲者备注 · 长 deck 分阶段模式 |

**✨ 智能填充 / AI 优化**：点一下就用「应用设置」里配的 LLM 把主题（或上传的文档）补全成「大纲 + 重点 + 设计偏好」，避免你逐项点选。前提是 Admin 已在「应用设置 → 模型配置」里配好默认模型并填了 API Key（见下文）。

**视觉风格 chip 网格**（10 种预设 + `auto`）：蓝图 · 工程方案 · 卡通绘本 · 莫兰迪 · 黑白线稿 · 杂志风 · 国风水墨 · 玻璃拟态 · 极简白 · 商务深色。「auto」由 agent 自主挑选，避免默认扁平卡片网格。

### 任务详情

![任务详情](./images/detail.png)

点击作品进入详情页，查看任务状态、费用、生成选项；通过 Tab 切换概览、原始输出、时间线、产物；可下载 `.pptx`，底部展示 Agent 各阶段执行进度。失败原因按友好化文案展示（见下一节）。

### 管理后台

![管理后台](./images/admin.png)

管理员专用（`#/admin`），含 5 个 Tab：

| Tab | 说明 |
|---|---|
| 概览 | 任务统计、活跃用户、失败任务 |
| 用户 | 改 role / quota / 重置密码 |
| 任务 | 全站任务列表、取消、标记失败、手动退款 |
| JOB 设置 | **每 job 一个 Docker 容器** 的运行参数（并发上限、镜像、内存、CPU、超时） |
| 应用设置 | **新增** — LLM 模型配置、API Key、协议、启停与默认标记 |

「应用设置 → 模型配置」是后续 AI 智能填充、提示词优化的依赖：

- 支持多个 provider（minimax、deepseek），**当前仅 Anthropic Messages 协议**
- 表单内联增删改；API Key 仅存于后端 secrets（不进入容器环境变量），列表里只显示「已设置 / 未设置」徽标
- 校验：name ≤ 64 字符、unique、http(s) base_url、至多 32 个模型、至多 1 个默认
- 修改后**仅对新启动的请求生效**

详见下文 [Admin 管理后台](#admin-管理后台) 章节与 `Docs/development.md`。

## 错误文案友好化

任务跑挂时，数据库里存的是机器字符串（`stop_reason=...`、`auto-resume bailed`、`docker image ... not found`、`watchdog: ...`）。`backend/runner/errors.py::humanize_error` 在写库前把它们翻成**人话**，UI 直接展示友好文案而不是堆栈：

| 机器串（前缀/子串） | 友好文案 |
|---|---|
| `auto-resume bailed` | AI 未生成有效内容，请调整需求后重试 |
| `claude CLI 失败` / `auto-resume claude CLI 失败` | AI 服务调用失败，请稍后重试 |
| `stop_reason=...` | AI 生成中断，请重试 |
| `runner exception:` / `resume exception:` | 生成过程异常，请重试 |
| `watchdog:` | 生成超时未响应，请重试 |
| `server restart interrupted` | 服务重启中断了任务，请重试 |
| `docker daemon is not available` / `docker image ... not found` / ... | 运行环境未就绪，请联系管理员 |

未命中任何模式的串**原样透传**（不吞错），对人话已做幂等处理。错误信息在卡片、详情页、Admin 任务列表三处一致展示。

## 失败任务原地重试

`POST /api/jobs/{id}/retry`（仅限 `failed` / `cancelled` 状态）原地重跑，**沿用原始 prompt + 选项**，不必重新填表。WebUI 在「我的作品」卡片底部、任务详情页顶部各提供一个「重试」入口；credits 不足时按钮 disabled。重试在数据层复用同一 job_id、events 表追加新阶段记录，旧失败原因保留在事件流中可回看。

## 已完成任务的修改（Edit / Revisions）

对 `status === 'done'` 的任务，可在 WebUI 卡片悬停时点「编辑」图标进入「修改」页（或访问 `/jobs/{id}/edit`）。在要改的页下面写意见、勾选确认后提交——后端会**新建一个 revision job**（`revision_of_job_id` 指向原任务），把原 deck 整个复制到 revision 的隔离目录，**扣 1 credit**，然后用 `claude --resume <原 session_id>` 把修改意见喂回去。

![作品列表（已完成的 PPT 卡片）](./images/edit-01-dashboard.png)

**编辑页**（`/jobs/{id}/edit`）：11 张缩略图 1×2 网格（移动端 1 列），每张下面一个 textarea，限 1000 字符。底部 sticky 底栏有"我已检查全部 N 张图"勾选 + "提交修改"按钮（无意见 / 未勾选 / 提交中均 disabled），并显示"将扣 1 个积分"提醒。

![编辑页 — 11 张缩略图 + 每页意见框](./images/edit-02-edit-page.png)

**任务详情**（原任务）新增"编辑修改"链接（与"下载"按钮并列）；"下载 PPTX"自动指向**最新**已完成的 revision，文件名带版本号后缀；底部"版本历史"区列出整条链，每条带「原版/最新」徽标、状态、提交时间、评论摘要，并可单独下载。

![任务详情 — 版本历史区（最新版本标"最新"，原版仍可单独下载）](./images/revisions-03-job-detail.png)

**最新版本身的详情**（上面的 0a963318… 就是 r2，是这个用户的第二次修改）：它自身是「原版 + 最新」（没有再下层的 revision），详情底部仍然展示版本历史。Agent 的 last_agent_text（"Now let me rewrite page_02_pain.svg ..."）也能直接看到，方便你确认它改对了页。

![最新版详情 — 自带版本历史 + Agent 最后输出](./images/revisions-04-latest-revision.png)

关键设计：

- **新 job 独立**：revision 走自己的 status / events / cancel / pptx，UI 上像看一个全新任务一样看进度
- **历史版本不限制**：每次修改留一个版本；详情页"版本历史"列出全部，可点开下载任意历史 pptx
- **下载默认最新**：`/jobs/{id}/pptx` 在前端被"版本历史"逻辑改写为指向最新 `is_latest && status === 'done'` 的 revision
- **session 不可用时降级**：若服务重启导致原 `session_id` 丢失，prompt 切到「无上下文」模板，提示 agent 读 `design_spec.md` + `svg_output/` 自助修改，**自动放行**（不需要用户额外确认）
- **单轮**：本轮只跑一次；想再改就再次点"编辑"重新提交

截图脚本：`scripts/screenshot_revisions.py`（用 Playwright，自动登录 admin、定位一个已存在 revision 链的 job 拍 4 张）。

API 列表：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET`  | `/api/jobs/{id}/edit-targets`   | 取可编辑性 + 11 张幻灯图（含 `current_note`）|
| `POST` | `/api/jobs/{id}/revisions`      | 提交 `{items: [{slide_index, comment}]}`；返回 `{revision_job_id, status}` |
| `GET`  | `/api/jobs/{id}/revisions`      | 取本任务 + 后续 revisions 链（含 `is_latest` 标记）|

后端实现：`backend/runtime/revisions.py`（`copy_project_dir` + `queue_revision` + prompt 模板）、`backend/api/routes/jobs.py`（3 个端点）、`backend/tests/test_revisions.py`（13 个单测）。

## 渲染与选图稳定性（自动化安全网）

近几轮加固了两条自动防线，避免"幻灯片空白 / 配图吓哭用户"等隐性失败：

- **SVG 命名空间修复** — LLM 在生成 SVG 时偶尔会写出 `xmlns:ns0="http://www.w3.org/1990/svg"`（年份写错）之类的坏根命名空间，导致浏览器整页空白。`ppt-master/scripts/svg_finalize/repair_namespace.py` 在 `finalize_svg.py` 的最后一步无条件跑一遍，把所有指向 `*/YYYY/svg`（`YYYY != 2000`）的元素重打标签到正确命名空间；同时 `backend/runner/preview.py::list_slides` 在检测到 `svg_output/` 比 `svg_final/` 新时会**自动同步 + 修复**，所以单页重生成后预览永远自愈。后端在 `GET /api/jobs/{id}/slides`、`/slides/{i}`、`/preview` 三个端点加了 `lxml`-based `_is_renderable_svg` 闸，坏文件返回 `503` 而不是静默给空 SVG。
- **图像安全过滤** — `image_safety.py` 在 `image_search.py` 流程里加了两层：查询净化（`tired → overworked` 等情感词替换为可视化概念）+ 关键词黑名单（`teeth / gore / horror / wild animal close-up / …`）。全部候选被拒时自动 fallback 到 `image_gen.py` AI 生成。黄金集 `tests/fixtures/bad_image_selections/tired_teeth_p02_pain.jpg`（2026-06-25 事故图）固化在 `test_golden_image_selections.py` 中防回归。

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

第一次启动会自动跑 DB 迁移（`v1→v7`，v6→v7 加 `jobs.revision_of_job_id`）。

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
2. 5 个 Tab：
   - **概览**：任务统计、活跃用户、失败任务
   - **用户**：改 role / quota / 重置密码
   - **任务**：全站任务列表、取消、标记失败、手动退款、原地重试
   - **JOB 设置**（原「设置」）：最大并发数（1–50）、Docker runner（镜像、内存、CPU、超时）、**Claude Code 容器环境变量**（`ANTHROPIC_*` 模型/API、Secrets、自定义 env）、Watchdog 参数
   - **应用设置**（新增）：LLM **模型配置**（provider / protocol / base_url / model / API Key / 启停 / 默认），是「✨ 智能填充」「AI 优化」「提示词优化」等 Web 端 LLM 调用的来源
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

### 结构化生成选项

「创建任务」页（详见 [创建任务](#创建任务)）把生成选项分成了 **14 个字段**（见 `JobOptions` schema），以结构化中文段落注入 prompt 头部，让 agent 直接读而不必猜默认值：

- **画布与结构**：canvas、mode、page_count
- **视觉调性**：visual_style、color_mode、brand_hex、industry
- **图片策略**：image_strategy、icon_strategy
- **内容定位**：core_topic、outline、key_points
- **输出约束**：include_speaker_notes、split_mode、formula_policy

如果应用设置里没配 LLM，所有「✨ AI 优化 / 智能填充」按钮会降级为 disabled 状态并提示先去 Admin 配置；其他字段照常手动可选。

### 失败重试

失败 / 取消的任务可以**原地重试**（见 [失败任务原地重试](#失败任务原地重试)），沿用原始 prompt 与全部选项；不再需要手动复制粘贴重新创建。

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
