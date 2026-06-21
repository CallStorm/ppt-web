# 设计

> 最后更新：2026-06-21

> 最后更新：2026-06-21  
> 来源：原 DESIGN.md §0–§1

### 最关键的认知

**ppt-master 不是一个程序，而是一个「工作流剧本」（skill）。** 它本身没有 main 函数、没有 HTTP 接口——它是一份 `SKILL.md` 流程文档 + 一堆 Python 脚本，**必须由一个具备工具调用能力的 AI agent（如 Claude Code）去读懂剧本、按顺序跑脚本、逐页手写 SVG**。

因此「在线生成工具」的本质不是「给 ppt-master 包个网页」，而是：

> **让服务器去扮演那个 AI IDE（Claude Code），由后端驱动 agent 执行剧本。**

记住这一点，整个架构就顺了。所有「进度回流」「八点确认」「调优」都是在这个认知上长出来的。

### 产品哲学

ppt-master 作者强调：「这是个工具不是许愿池，别指望一把出完美成品，价值在于帮你干掉枯燥的活，剩下的打磨交给你。」

因此本产品**不应该是「一键出片」**，而应该是 **「AI 主导生成 + 人在环路确认 + 逐页调优」** 的协作工具。把它的「八点确认」阻塞步骤原样搬到 Web 上，是产品化的最大卖点，而非要绕过的障碍。

### 产品定位

| 维度 | 说明 |
|------|------|
| **形态** | AI 主导、人机协作的在线 PPT 生成器，不是一键黑盒 |
| **核心卖点** | 产出**原生可编辑 PPTX**（真 DrawingML 形状/文本框/图表，PowerPoint 里逐元素可改） |
| **输入** | 文字内容、上传文档（PDF/DOCX/URL/Markdown/Excel/PPTX）、可选模板/品牌 |
| **输出** | `.pptx` + SVG 快照 + 设计规范，可下载、可在线预览、可调优、可看历史 |
| **门槛提示** | 生成质量与所用模型强相关（官方推荐 Claude Opus + gpt-image-2），需在 UI 明示成本与模型分级 |

### 与 ppt-master 的分工

```
用户 ──► ppt-web（Web 壳：鉴权、调度、进度、存储）
              │
              └──► claude CLI + ppt-master skill（生成引擎）
                        │
                        └──► 原生 pptx 产物
```

ppt-web 不重写 ppt-master 流水线，而是**驱动它**。详见 [architecture/execution-pipeline.md](architecture.md#任务执行流水线)。

### 当前产品策略差异

设计愿景强调「八点确认」为核心 UX，但**当前 MVP 默认关闭确认**（agent 直接采用推荐默认值跑完），以降低使用门槛。设计原理仍保留，可通过 `require_confirm` 或 prompt 指令启用。详见 [human-in-the-loop.md](design.md#人在环路八点确认)。

### 相关文档

- [product/overview.md](product.md#产品概览)
- [human-in-the-loop.md](design.md#人在环路八点确认)
- [cost-and-billing.md](design.md#成本与计费)

---

> 最后更新：2026-06-21  
> 来源：原 DESIGN.md §5  
> 相关代码：[`backend/runner/constants.py`](../backend/runner/constants.py)、[`backend/models/__init__.py`](../backend/models/__init__.py)

### 什么是八点确认

ppt-master 的 Step 4 是 ⛔ **BLOCKING**——agent 必须停下来等用户确认以下八项：

1. 画布格式（16:9 / 4:3 等）
2. 页数
3. 关键信息结构
4. 模式 + 风格模板
5. 配色方案
6. 图标策略
7. 字体选择
8. 图片策略（AI 生图 / 搜图 / 无图）

在本地 IDE 里是聊天等待；在 Web 上需要工程化的暂停/恢复机制。

### 设计实现方案

#### 1. 暂停点

agent 按 SKILL.md 走到确认环节时 `end_turn` 停下，backend 检测到：

- 无 pptx 产出
- agent 会话结束（有 `session_id`）

→ 判定 job 为 `paused`，向前端 SSE 推送 `paused` 事件。

#### 2. 前端确认面板

用户在网页上看到 agent 列出的八项推荐，可逐项修改（页数、主色、风格模板、是否 AI 生图…），点击「确认」提交。

#### 3. 恢复会话

```
POST /api/jobs/{id}/resume
Body: { "confirm": "确认，页数改为 8，主色 #2563EB..." }
```

backend 以 `--resume <session_id>` 重启 Docker 容器，将确认文本作为 user message 注入，agent 继续后续非阻塞步骤直到导出。

Phase 0 已验证：resume 不仅能「确认」，还能「修改 spec」（页数从 8 改 4 生效）。见 [phase0/REPORT.md](../phase0/REPORT.md)。

#### 备选：Agent SDK 自定义工具

原设计建议注册 `request_design_confirmation(spec_json)` 自定义工具。当前实现通过检测 agent 自然 pause 行为 + stream-json 解析，未使用 Agent SDK hooks。

### 当前产品策略（默认关闭）

**MVP 默认行为**：不弹八点确认面板，agent 直接采用 ppt-master 推荐默认值一气呵成导出 pptx。

实现细节：

| 配置 | 值 | 说明 |
|------|-----|------|
| `Job.require_confirm` | `false`（默认） | 创建 job 时不启用确认 |
| `AUTO_CONFIRM_TEXT` | 「确认，按你的推荐方案继续生成。」 | agent 暂停时自动注入 |
| `SKIP_EIGHT_CONFIRM_MAX` | `3` | 自动 resume 最大轮数 |

相关代码：[`backend/runner/constants.py`](../backend/runner/constants.py)

#### 如何启用八点确认

1. **API 层**：创建 job 时设 `require_confirm=true`（当前 Web UI 未暴露此选项）
2. **Prompt 层**：在 prompt 中写「在选定风格前先问我并等待确认」
3. **手动 resume**：job 进入 `paused` 状态后，在详情页提交确认文本

### 为什么默认关闭

| 考量 | 说明 |
|------|------|
| 降低门槛 | 新用户无需理解八项设计决策即可出片 |
| 减少等待 | 确认步骤增加交互轮次和总耗时 |
| 可 override | prompt 指令仍可触发 agent 主动询问 |

未来可在 Web UI 增加「生成前确认设计」开关，对应 `require_confirm` 字段。

### 相关文档

- [architecture/progress-events.md](architecture.md#进度事件与阶段映射) — paused 事件
- [product/user-guide.md](product.md#用户指南) — 用户侧说明
- [principles.md](design.md#核心认知与产品定位) — 产品哲学

---

> 最后更新：2026-06-21  
> 来源：原 DESIGN.md §6、§9  
> 相关代码：[`backend/paths.py`](../backend/paths.py)、[`docker/ppt-runner/`](../docker/ppt-runner/)

### 威胁模型

agent 有执行任意命令的能力。多租户场景**必须锁死**执行边界，否则一个恶意用户可：

- 读取其他用户的文件
- 执行宿主机命令
- 耗尽服务器资源
- 窃取 API key

### 已实现的隔离措施

#### 文件隔离

每个用户 / 每个 Job 独立目录：

```
data/users/<user_id>/
├── uploads/<job_id>/      ← 仅该 job 的上传
└── projects/<job_id>/     ← 仅该 job 的产物
```

- Agent SDK / Docker 的 `cwd` 限定在挂载的 `/work`
- 下载 preview/pptx 时校验路径 `is_under()` 允许根目录
- 上传文件名 `safe_stage_name()` 归一化，防 path traversal

#### 进程隔离

**每 job 一个 Docker 容器**（`ppt-runner:latest`）：

- `--rm` 跑完自动销毁
- `--memory=4g --cpus=2` 资源限制
- `--network=ppt-isolated` 独立 bridge
- 超时强杀（`DOCKER_RUNNER_TIMEOUT_S`）

#### 密钥隔离

- AI 模型 key、生图 key 放服务端 `.env` 或 Admin secrets
- **绝不下发到前端**
- 通过环境变量注入 Docker 容器，不写入 Job 记录或 Event

#### 鉴权与配额

| 措施 | 实现 |
|------|------|
| JWT cookie 会话 | `backend/auth/` |
| Job 所有权校验 | `require_owner_or_admin()` |
| 配额预扣 | 创建 job 扣 1 credit，失败 refund |
| 并发上限 | `MAX_CONCURRENT_JOBS`，超限 409 |
| Admin 审计 | `AdminActionLog` 记录写操作 |

### 尚未实现的加固

| 措施 | 状态 | 说明 |
|------|------|------|
| 命令白名单 PreToolUse | ⬜ | 容器内 `--dangerously-skip-permissions` |
| gVisor / seccomp | ⬜ | 更强容器隔离 |
| 网络 egress 限制 | ⬜ | 除生图外禁外网 |
| OAuth 登录 | ⬜ | 当前仅邮箱密码 |
| 对象存储 signed URL | ⬜ | 当前本地文件直读 |

### 登录与权限（当前）

- 邮箱密码注册/登录，JWT HTTP-only cookie
- 角色：`user`（默认）| `admin`（跳过 ownership 校验）
- 管理后台：用户管理、Job 监控、运行时配置

原设计中的 OAuth（GitHub/Google）和 better-auth 尚未集成。

### 部署建议

| 环境 | 最低要求 |
|------|----------|
| 自用 / 小范围 | Docker 隔离 + 改 admin 密码 + 固定 JWT secret |
| 多租户公开 | 上述 + MySQL + 反向代理 TLS + 定期备份 + 监控 |
| 正式商业化 | 上述 + 命令白名单 + 更强沙箱 + 真实计费 |

### 相关文档

- [deployment/docker-runner.md](deployment.md#docker-runner-镜像)
- [deployment/production.md](deployment.md#生产环境部署)
- [architecture/data-model.md](architecture.md#数据模型与文件布局)

---

> 最后更新：2026-06-21  
> 状态：**规划中**（Web 未实现，ppt-master 已具备底层能力）  
> 来源：原 DESIGN.md §7–§8

### 设计愿景

ppt-master 作者说「工具不是许愿池」——生成完之后的**打磨**才是长期价值。设计三档调优能力：

#### 1. 全局调整

改配色 / 字体 / 风格 → 复用 ppt-master 的 `update_spec.py`（把 `spec_lock.md` 的改动同步到所有已生成 SVG）+ 重新导出。

Web 端设想：一个「换肤」面板，用户选新配色/字体，触发 update_spec + svg_to_pptx。

#### 2. 逐页重做

用户选中第 N 页，输入「改成两栏 / 换张图 / 精简文字」→ 起一个（或 resume）Agent 会话，cwd=项目目录，指令让它只重写该页 SVG + 重新导出。

ppt-master 有 `resume-execute` 工作流支持断点续跑。

#### 3. 可视化批注

ppt-master 自带 `live-preview` 工作流和 `svg_editor/server.py`。前端内嵌 SVG 预览，用户在页面上圈选/批注，批注通过 `check_annotations.py` 回传给 agent，agent 据此修改。

**这是体验差异化的杀手锏**——所见即所得地指挥 AI 改 PPT。

### 版本管理设计

原设计数据模型：

```
projects(id, user_id, name, ...)
  └ versions(id, project_id, pptx_key, svg_snapshot_key, design_spec_key, ...)
  └ sources(id, project_id, filename, ...)
```

- 每次成功导出一个 `version`
- pptx + svg 快照 + design_spec 入对象存储，DB 存指针
- ppt-master 本身已把 `svg_output/` 镜像到 `backup/<timestamp>/`

### 当前实现

| 能力 | 状态 |
|------|------|
| 单次生成 + 下载 | ✅ |
| Job 历史列表 | ✅ |
| 同一 PPT 多次调优 | ⬜ |
| 版本回溯 | ⬜ |
| update_spec Web UI | ⬜ |
| 逐页重做 | ⬜ |
| SVG 批注预览 | ⬜ |
| projects/versions 表 | ⬜ |

当前一个 Job = 一次生成。产物在 `data/users/<uid>/projects/<job_id>/` 下，删除 job 会清理文件。

### ppt-master 可复用能力

| 工具/工作流 | 用途 |
|-------------|------|
| `update_spec.py` | 全局换肤 |
| `resume-execute` | 断点续跑 |
| `visual-review` | 视觉自检 |
| `svg_editor/server.py --live` | 实时预览 + 批注 |
| `check_annotations.py` | 批注回传 |
| `backup/<timestamp>/` | 自动版本镜像 |

参考：[`ppt-master/skills/ppt-master/SKILL.md`](../ppt-master/skills/ppt-master/SKILL.md)

### 落地建议

1. **Phase 2a**：引入 `projects` 表，一个 project 下多个 job（type: new | tune）
2. **Phase 2b**：Web 端「基于此版本再调优」按钮，resume agent 会话
3. **Phase 2c**：集成 svg_editor live preview + 批注

### 相关文档

- [architecture/data-model.md](architecture.md#数据模型与文件布局)
- [product/features.md](product.md#功能实现状态)

---

> 最后更新：2026-06-21  
> 来源：原 DESIGN.md §10  
> 相关代码：[`backend/models/__init__.py`](../backend/models/__init__.py)

### 成本现实

ppt-master 官方推荐 **Claude Opus + gpt-image-2**。一份 10 页 deck 单次生成成本可能 **$5–20**，且 Executor 要求单会话逐页连续生成，又长又贵。

Phase 0 实测（glm-5.2，4 页）：**$2.89**。换 Opus 后成本会显著上升，与设计预估一致。

| 阶段 | glm-5.2 实测 |
|------|-------------|
| Strategist + 八点确认 | $0.51 |
| design_spec + 4 页 SVG + 导出 | $2.38 |
| **合计** | **$2.89** |

### 产品设计要点

#### 模型分层

| 环节 | 建议模型 | 说明 |
|------|----------|------|
| Strategist / Executor | Opus 或 Sonnet | 创意环节，质量关键 |
| 素材解析、质检、后处理 | Haiku 或直接跑脚本 | 确定性步骤，不调模型 |

当前：Admin 可配 Claude env 变量，用户侧无模型选择 UI。

#### 预览即扣费

进入生成前展示预估 token / credits，用户确认才扣。

**当前**：创建 job 直接预扣 1 credit，无成本预估 UI。

#### 配额与套餐

| 机制 | 当前实现 |
|------|----------|
| 免费额度 | 新用户默认 100 credits |
| 预扣 | 创建 job 扣 1 |
| 退款 | 任务失败自动 refund |
| Admin 调整 | 可改用户 quota |
| 真实支付 | ⬜ 未实现 |

#### 缓存复用

调优时复用已有 SVG / spec，只重做变化部分，省钱省时。依赖 [tuning-and-versions.md](design.md#调优与版本管理) 中的版本管理。

#### 降级选项

允许用户选 Sonnet / Gemini Flash 等便宜模型，明确告知质量上限会下降。

ppt-master 作者原话：「效果不理想先换模型，别质疑 harness。」

### 成本记录

每个 Job 的 `cost_usd` 字段从 claude stream-json 输出解析累计。Admin 可在任务列表查看。

### 风险

1. **长会话成本不可控** — 10+ 页单会话可能很长，需配额硬上限
2. **生图额外费用** — gpt-image-2 等按张计费
3. **无预算告警** — 当前无用户侧余额不足预警（仅 402 拒绝）

### 商业化路线（规划）

- Phase 3：充值 credits、套餐、生成前成本预估
- 管理后台成本看板（部分数据已有，UI 待完善）
- 按实际 token 结算 vs 固定 per-job 扣费

### 相关文档

- [phase0/REPORT.md](../phase0/REPORT.md) — 实测成本
- [product/features.md](product.md#功能实现状态)
- [security-sandbox.md](design.md#安全沙箱与多租户隔离) — 配额机制
---

## 相关文档

- [README.md](README.md) — 文档导航
- [product.md](product.md) — 产品
- [architecture.md](architecture.md) — 架构
- [design.md](design.md) — 设计（详细；根目录 [DESIGN.md](../DESIGN.md) 为摘要索引）
- [development.md](development.md) — 开发
- [deployment.md](deployment.md) — 部署
- [reference.md](reference.md) — 参考
