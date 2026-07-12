# 产品

> 最后更新：2026-06-21

> 最后更新：2026-06-21  
> 相关代码：[`README.md`](../README.md)、[`DESIGN.md`](../DESIGN.md)

### 是什么

**ppt-web** 是把开源 [ppt-master](https://github.com/hugohe3/ppt-master) 包装成「开箱即用」在线服务的 Web 应用。用户通过浏览器输入文字或上传文档，由 AI agent 驱动 ppt-master 完整流水线，最终产出**原生可编辑的 `.pptx` 文件**（真 DrawingML 形状/文本框，而非图片式演示）。

### 解决什么问题

| 痛点 | ppt-web 的做法 |
|------|----------------|
| ppt-master 需在本地 IDE（Claude Code）中手动运行 | 服务器扮演 Claude Code，Web 端一键提交任务 |
| 生成过程黑盒、耗时长 | SSE 实时推送流水线阶段与逐页 SVG 进度 |
| 多用户无法共享同一台机器 | 多用户鉴权 + 按用户/任务隔离数据目录 + Docker 容器隔离执行 |
| 生成结果难以追溯 | Job 历史列表、事件回放、pptx 下载 |

### 与 ppt-master 的关系

```
ppt-web（本仓库）
├── backend/          ← Web API、任务调度、Docker 编排
├── webui/            ← React 前端
├── docker/           ← 每 job 一个临时容器
└── ppt-master/       ← 上游 clone（build 时或 ensure 脚本），生成引擎（skill + 脚本）
```

**关键认知**：ppt-master 不是一个独立程序，而是一份 **SKILL.md 工作流剧本** + Python 脚本集合。它必须由具备工具调用能力的 AI agent（Claude Code）读懂并按顺序执行。ppt-web 的本质是**让服务器扮演那个 AI IDE**，而不是「给 ppt-master 简单包个网页」。

详见 [design/principles.md](design.md#核心认知与产品定位)。

### 产品形态

- **AI 主导、人机协作**的在线 PPT 生成器，不是一键黑盒出片
- **输入**：文字描述、上传文档（PDF/DOCX/Markdown 等）
- **输出**：`.pptx` + SVG 快照 + 设计规范，可下载、可预览
- **协作**：可选的「八点确认」暂停点（当前默认关闭，见 [design/human-in-the-loop.md](design.md#人在环路八点确认)）

### 目标用户

- 需要快速生成演示文稿的内容创作者、产品经理、开发者
- 希望复用 ppt-master 能力但不想本地配置 Claude Code 的用户
- 小团队内部部署、共享 AI PPT 生成能力

### 当前成熟度

| 阶段 | 状态 |
|------|------|
| Phase 0 技术验证 | ✅ 完成（[phase0/REPORT.md](../phase0/REPORT.md)） |
| MVP（Web + 鉴权 + 任务 + 进度 + 下载） | ✅ 大部分完成 |
| 多租户增强（OAuth、对象存储、调优 UI） | 🟡 部分完成 |
| 商业化（真实计费、模型分层） | ⬜ 规划中 |

完整功能对照见 [features.md](product.md#功能实现状态)。

---

> 最后更新：2026-06-21  
> 相关代码：[`backend/`](../backend/)、[`webui/src/`](../webui/src/)

本文档对照 [DESIGN.md](../DESIGN.md) 中的设计愿景与当前代码实现，标注 ✅ 已实现、🟡 部分实现、⬜ 未实现。

### 核心生成能力

| 功能 | 状态 | 说明 |
|------|------|------|
| 文字 prompt 创建任务 | ✅ | `POST /api/jobs` |
| 上传文档作为素材 | ✅ | multipart 上传，单文件 ≤25MB，总计 ≤50MB |
| 任务选项（语言/场景/受众/语气/页数） | ✅ | `options_json` 注入 prompt |
| 驱动 ppt-master 完整流水线 | ✅ | Docker 容器内 `claude CLI` |
| 产出原生可编辑 pptx | ✅ | Phase 0 已验证 |
| 封面预览图 | ✅ | `GET /api/jobs/{id}/preview` |
| pptx 下载 | ✅ | `GET /api/jobs/{id}/pptx` |

### 进度与交互

| 功能 | 状态 | 说明 |
|------|------|------|
| 实时进度时间线 | ✅ | SSE `GET /api/jobs/{id}/events` |
| 8 阶段流水线映射 | ✅ | [`backend/runner/stages.py`](../backend/runner/stages.py) |
| 逐页 SVG 进度推送 | ✅ | 阶段 6 每页一条事件 |
| 八点确认 Web 面板 | 🟡 | API 支持 `resume`，UI 有暂停恢复；**默认自动跳过确认** |
| WebSocket 推送 | ⬜ | 实际使用 SSE |
| 可视化 SVG 批注 | ⬜ | ppt-master 有 `svg_editor`，Web 未集成 |
| live-preview 实时预览 | ⬜ | 规划引用 ppt-master 能力 |

### 用户与鉴权

| 功能 | 状态 | 说明 |
|------|------|------|
| 邮箱密码注册/登录 | ✅ | JWT cookie 会话 |
| 多用户数据隔离 | ✅ | `data/users/<uid>/` |
| 配额 credits 预扣 | ✅ | 创建 job 扣 1，失败退款 |
| OAuth（GitHub/Google） | ⬜ | 设计中有，未实现 |
| 管理后台 | ✅ | Admin 用户/任务/运行时配置 |

### 任务管理

| 功能 | 状态 | 说明 |
|------|------|------|
| 任务列表（Dashboard） | ✅ | 按用户过滤 |
| 任务详情 + 事件流 | ✅ | JobDetailPage + SSE |
| 取消运行中任务 | ✅ | `POST /api/jobs/{id}/cancel` |
| 删除已完成任务 | ✅ | 同时清理 uploads/projects 目录 |
| 并发上限 | ✅ | `MAX_CONCURRENT_JOBS`，超限 409 |
| 卡住任务 watchdog | ✅ | 启动时清理 + 运行时监控 |

### 运行时与隔离

| 功能 | 状态 | 说明 |
|------|------|------|
| 每 job 一个 Docker 容器 | ✅ | `ppt-runner:latest`，跑完 `--rm` 销毁 |
| 容器资源限制 | ✅ | memory/CPU/timeout 可配 |
| 独立 bridge 网络 | ✅ | `ppt-isolated` |
| Claude Agent SDK hooks | ⬜ | 使用 `claude CLI` + stream-json 解析 |
| Celery + Redis 队列 | ⬜ | 进程内 asyncio dispatcher |
| 命令白名单 PreToolUse | ⬜ | 容器内 `--dangerously-skip-permissions` |
| gVisor / 更强沙箱 | ⬜ | 规划 |

### 存储与数据模型

| 功能 | 状态 | 说明 |
|------|------|------|
| MySQL 8 | ✅ | Docker 启动，见 README |
| 本地文件存储 | ✅ | `data/users/` |
| 对象存储 S3/MinIO | ⬜ | 设计中有，未实现 |
| projects/versions/sources 多表 | ⬜ | 当前简化为 User + Job + Event |
| 版本回溯与再调优 | ⬜ | ppt-master 有 backup 机制，Web 未暴露 |

### 调优与后处理

| 功能 | 状态 | 说明 |
|------|------|------|
| 全局换肤（update_spec.py） | ⬜ | 规划 |
| 逐页重做 SVG | ⬜ | 规划，可 resume agent 会话 |
| 可视化批注驱动修改 | ⬜ | 规划 |

### 计费与成本

| 功能 | 状态 | 说明 |
|------|------|------|
| 配额 credits | ✅ | 简单整数预扣 |
| 任务 cost_usd 记录 | ✅ | 从 claude 输出解析 |
| 生成前成本预估 | ⬜ | 规划 |
| 真实支付/套餐 | ⬜ | 规划 |
| 模型分层选择 | 🟡 | Admin 可配 Claude env，用户侧无 UI |

### 前端

| 功能 | 状态 | 说明 |
|------|------|------|
| React SPA | ✅ | Vite 8 + React 19 + Tailwind 4 |
| 登录页 | ✅ | `/login` |
| 任务列表 Dashboard | ✅ | `/` |
| 新建任务 | ✅ | `/jobs/new` |
| 任务详情 + 进度 | ✅ | `/jobs/:id` |
| Admin 管理页 | ✅ | `/admin`（admin 角色） |
| Next.js SSR | ⬜ | 设计建议 Next.js，实际 Vite SPA |

### 部署与运维

| 功能 | 状态 | 说明 |
|------|------|------|
| 手动部署文档 | ✅ | README + Docs/deployment.md |
| docker-compose 一键部署 | ⬜ | 未提供 |
| CI/CD pipeline | ⬜ | 根目录无 `.github/workflows/` |
| API 自身 Docker 镜像 | ⬜ | 仅 job runner 有 Dockerfile |

---

> 最后更新：2026-06-21  
> 相关代码：[`webui/src/pages/`](../webui/src/pages/)

### 访问与登录

1. 打开服务地址（本地默认 `http://127.0.0.1:8765/`）
2. 首次使用点击注册，填写邮箱与密码（至少 6 位）
3. 登录后进入任务列表（Dashboard）

**默认管理员**（首次启动自动创建）：账号 `admin` / 密码 `admin`。生产环境请立即修改密码。

### 创建 PPT 任务

1. 点击「新建任务」或访问 `/jobs/new`
2. 填写 **Prompt**：描述你想要的 PPT 主题、内容要点、风格偏好
3. （可选）上传参考文档：PDF、DOCX、Markdown 等
4. （可选）调整任务选项：
   - 语言（默认中文）
   - 场景、受众、语气
   - 期望页数（默认 5 页）
5. 提交后任务进入队列，跳转到任务详情页

**配额**：每创建一个任务预扣 1 个 credit。任务失败会自动退还。

### 查看进度

任务详情页通过 SSE 实时显示：

| 阶段 | 含义 |
|------|------|
| 1 解析素材 | 源文档转 Markdown |
| 2 建项目 | `project_manager.py init` |
| 3 策略规划 | 生成 `design_spec.md` |
| 5 生图 | AI 生成或搜索图片 |
| 6 逐页生成 SVG | Executor 逐页写 SVG |
| 7 质检 | SVG 质量检查 |
| 8 后处理 / 导出 PPTX | _finalize + svg_to_pptx |

阶段 6 会逐页推送「第 N 页」事件，耗时最长。

### 下载结果

任务状态变为 **done** 后：

- 点击「下载 PPTX」获取 PowerPoint 文件
- 封面预览图在详情页展示（若已生成）

### 取消与删除

- **取消**：运行中或排队中的任务可取消；已启动的 Docker 容器会被停止
- **删除**：仅已完成/失败/已取消的任务可删除；会同时清理服务器上的上传文件与项目目录

### 生成行为说明

**当前默认策略**：agent 直接采用 ppt-master 推荐默认值（画布、页数、风格、配色等），一气呵成跑完所有步骤直到导出 pptx。

- 不会弹出「八点确认」面板
- 如需调整，可在 prompt 中明确描述，或重新创建任务

如需启用八点确认暂停，见 [design/human-in-the-loop.md](design.md#人在环路八点确认)。

### 管理后台（Admin）

管理员登录后侧边栏出现「管理后台」，或直接访问 `/admin`。

可执行操作：

| 模块 | 功能 |
|------|------|
| 概览 | 任务统计、活跃用户、失败任务 |
| 用户管理 | 查看用户、修改 role/quota、重置密码（PATCH users） |
| 任务管理 | 全站任务列表、取消、标记失败、手动退款 |
| 运行时配置 | GET/PATCH `/api/admin/settings`：并发、Docker、Claude env、Secrets |

配置修改后**仅对新启动的任务/容器生效**。

Admin API 完整文档：启动服务后访问 `/docs`，筛选 `admin` tag。

---

## 完成后编辑（Revisions）

对 `status === 'done'` 的任务，可在 WebUI 卡片悬停时点「编辑」进入修改页（或访问 `/jobs/{id}/edit`）。在要改的页下面写意见、勾选确认后提交——后端会**新建一个 revision job**（`revision_of_job_id` 指向原任务），把原 deck 复制到 revision 的隔离目录，**扣 1 credit**，然后用 `claude --resume <原 session_id>` 把修改意见喂回去。

![作品列表（已完成的 PPT 卡片）](../images/edit-01-dashboard.png)

**编辑页**（`/jobs/{id}/edit`）：幻灯片缩略图网格，每张下面一个 textarea（限 1000 字符）。底部 sticky 底栏有「我已检查全部 N 张图」勾选 + 「提交修改」按钮（无意见 / 未勾选 / 提交中均 disabled），并显示「将扣 1 个积分」提醒。也支持**全局修改**（换色、换字体、自定义 deck 级指令）。

![编辑页 — 缩略图 + 每页意见框](../images/edit-02-edit-page.png)

**任务详情**（原任务）有「编辑修改」链接（与「下载」并列）；「下载 PPTX」默认指向**最新**已完成的 revision，文件名带版本号后缀；底部「版本历史」区列出整条链，每条带「原版/最新」徽标、状态、提交时间、评论摘要，并可单独下载。

![任务详情 — 版本历史区](../images/revisions-03-job-detail.png)

**最新 revision 的详情页**同样展示版本历史；Agent 的 `last_agent_text` 可直接查看，便于确认改对了哪一页。

![最新版详情 — 版本历史 + Agent 输出](../images/revisions-04-latest-revision.png)

### 关键设计

- **新 job 独立**：revision 走自己的 status / events / cancel / pptx，UI 上像看一个全新任务一样看进度
- **历史版本不限制**：每次修改留一个版本；详情页「版本历史」列出全部，可下载任意历史 pptx
- **下载默认最新**：前端「版本历史」逻辑将下载指向最新 `is_latest && status === 'done'` 的 revision
- **session 不可用时降级**：若服务重启导致原 `session_id` 丢失，prompt 切到「无上下文」模板，提示 agent 读 `design_spec.md` + `svg_output/` 自助修改
- **单轮**：本轮只跑一次；想再改就再次点「编辑」重新提交

截图脚本：`scripts/screenshot_revisions.py`（Playwright，需已有带 revision 链的 done job）。

### API

| 方法 | 路径 | 用途 |
|------|------|------|
| `GET` | `/api/jobs/{id}/edit-targets` | 可编辑性 + 幻灯片缩略图（含 `current_note`） |
| `POST` | `/api/jobs/{id}/revisions` | 提交逐页 `{mode:"per_page", items:[{slide_index, comment}]}` 或全局 `{mode:"global", global_revision:{...}}`；返回 `{revision_job_id, status}` |
| `GET` | `/api/jobs/{id}/revisions` | 本任务 + 后续 revisions 链（含 `is_latest`） |

后端实现：`backend/runtime/revisions.py`、`backend/api/routes/jobs.py`、`backend/tests/test_revisions.py`。

---

## 相关文档

- [README.md](README.md) — 文档导航
- [product.md](product.md) — 产品
- [architecture.md](architecture.md) — 架构
- [design.md](design.md) — 设计（详细；根目录 [DESIGN.md](../DESIGN.md) 为摘要索引）
- [development.md](development.md) — 开发
- [deployment.md](deployment.md) — 部署
- [reference.md](reference.md) — 参考
