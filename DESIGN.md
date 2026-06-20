# PPT 在线生成工具 — 系统设计文档

> 基于开源 [ppt-master](https://github.com/hugohe3/ppt-master) + Claude Code（Claude Agent SDK）包装的在线 PPT 生成工具。
> 用户可输入文字 / 上传文档 → 生成 PPT → 实时显示进度 → 生成完可调优 / 保存 / 查看历史 → 需登录。
>
> 本文为初步设计，覆盖架构、运行时、进度回流、人在环路、安全沙箱、数据模型、调优、计费、技术栈、风险与落地路线。

---

## 0. 最关键的认知

**ppt-master 不是一个程序，而是一个"工作流剧本"（skill）。** 它本身没有 main 函数、没有 HTTP 接口——它是一份 `SKILL.md` 流程文档 + 一堆 Python 脚本，**必须由一个具备工具调用能力的 AI agent（如 Claude Code）去读懂剧本、按顺序跑脚本、逐页手写 SVG**。

因此"在线生成工具"的本质不是"给 ppt-master 包个网页"，而是：

> **让服务器去扮演那个 AI IDE（Claude Code），由后端驱动 agent 执行剧本。**

记住这一点，整个架构就顺了。所有"进度回流""八点确认""调优"都是在这个认知上长出来的。

作者自己反复强调："这是个工具不是许愿池，别指望一把出完美成品，价值在于帮你干掉枯燥的活，剩下的打磨交给你。" 所以本产品**不应该是"一键出片"**，而应该是 **"AI 主导生成 + 人在环路确认 + 逐页调优"** 的协作工具。把它的"八点确认"阻塞步骤原样搬到 Web 上，是产品化的最大卖点，而非要绕过的障碍。

---

## 1. 产品定位与现实校准

- **形态**：AI 主导、人机协作的在线 PPT 生成器，不是一键黑盒。
- **核心卖点**：产出**原生可编辑 PPTX**（真 DrawingML 形状/文本框/图表，PowerPoint 里逐元素可改），而非图片式 / HTML 演示。
- **输入**：文字内容、上传文档（PDF/DOCX/URL/Markdown/Excel/PPTX）、可选模板/品牌。
- **输出**：`.pptx` + SVG 快照 + 设计规范，可下载、可在线预览、可调优、可看历史。
- **门槛提示**：生成质量与所用模型强相关（官方推荐 Claude Opus + gpt-image-2），需在 UI 明示成本与模型分级。

---

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│  浏览器 (Next.js + React)                                       │
│  登录 │ 新建任务(输入文字/上传文档/选模板) │ 进度时间线 │          │
│  八点确认面板 │ SVG 实时预览+逐页批注 │ 历史列表 │ 下载/调优       │
└───────────────┬──────────────────────────────────┬───────────┘
        HTTPS/WebSocket/SSE                          │
┌───────────────▼──────────────────────────────────▼───────────┐
│  API 网关层 (FastAPI)  — 鉴权、配额、任务CRUD、文件上传           │
└───────────────┬──────────────────────────────────────────────┘
        │  下发 Job                                ▲  回流进度/确认
┌───────▼──────────────────────────────────────────┴───────────┐
│  任务队列 (Celery + Redis)  +  Job 状态库 (Postgres)            │
└───────────────┬──────────────────────────────────────────────┘
        │ 取 Job
┌───────▼──────────────────────────────────────────────────────┐
│  Worker 池 (每个 Job 一个隔离沙箱进程/容器)                       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Claude Agent SDK 会话  (cwd = 用户项目目录)               │ │
│  │   ├ system 上下文 = ppt-master/SKILL.md                  │ │
│  │   ├ 权限白名单: 只允许跑 ppt-master 的脚本 + 项目目录读写 │ │
│  │   ├ Hooks(PostToolUse): 探测当前流水线阶段 → 推进度事件  │ │
│  │   └ 人在回路回调: 遇到"八点确认"暂停 → 求用户 → 恢复      │ │
│  │         ↓ 驱动执行                                         │ │
│  │  ppt-master 真实流水线 (project_manager → Strategist →   │ │
│  │   Image_Generator → Executor逐页SVG → 质检 → 后处理 →     │ │
│  │   svg_to_pptx 导出)                                       │ │
│  └─────────────────────────────────────────────────────────┘ │
│  产物: exports/*.pptx, svg_output/*.svg, design_spec.md        │
└───────────────┬──────────────────────────────────────────────┘
        │ 落盘
┌───────▼──────────────────────────────────────────────────────┐
│  存储: 对象存储(pptx/svg/源文件) + Postgres(元数据/历史/版本)    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 核心运行时：用 Claude Agent SDK 驱动 ppt-master

这是整个方案的"心脏"。**不要自己重写流水线编排**，而是用 Claude Agent SDK 去跑 ppt-master 自带的 skill。

ppt-master 是 Claude Code 的 skill，依赖 agent 的"多轮 + 工具调用 + 文件操作"能力。Agent SDK（有 TS 和 Python 两个版本）正是把这个能力以库的形式暴露出来，并支持：

- **hooks**（PreToolUse / PostToolUse / Stop）
- **权限模式**（命令白名单、路径限定）
- **MCP**
- **会话 `--resume`**（暂停/恢复）

这些恰好是"进度回流"和"八点确认暂停/恢复"所必需的——是选 Agent SDK 而非裸 Anthropic API 的核心理由。

### 每个 Worker 一次生成任务的执行步骤

1. **准备项目目录**：`project_manager.py init <name> --format ppt169` → `import-sources` 把用户上传的文档拷进去。
2. **起一个 Agent SDK 会话**：`cwd` 指向该项目目录，把 `skills/ppt-master/SKILL.md` 作为 system 上下文注入，初始 prompt = 用户的文字需求 + "请严格按 SKILL.md 执行"。
3. agent 自己按剧本跑：源文档转 md → Strategist 出设计规范 →（生图）→ Executor 逐页手写 SVG → 质检 → 后处理 → 导出 pptx。
4. 全程通过 **hooks** 把进度回流给前端（见第 4 节）。
5. 产物落盘后入库，前端可下载/预览。

### 备选方案（更可控但维护重）

不跑完整 skill，而是把 ppt-master 的 Python 脚本作为确定性后端步骤调用，只用 Claude 做 Strategist（出规范）和 Executor（写 SVG）两个创意环节。优点是流程可控、易计费；缺点是要自己维护一份编排，且跟不上上游更新。

**建议 MVP 先用"跑真实 skill"路线**，验证可行后再考虑局部替换。

---

## 4. 进度回流：把 ppt-master 的串行流水线映射成前端时间线

ppt-master 是**严格串行**流水线，天然适合做进度条。把它的 Step 映射成阶段：

| 阶段 | 对应 ppt-master 步骤 | 实现方式 |
|---|---|---|
| 1 解析素材 | `source_to_md/*.py` | PostToolUse hook 捕获到该脚本被调用 |
| 2 建项目 | `project_manager.py init/import` | 同上 |
| 3 策略规划 | Strategist 写 `design_spec.md` | hook 检测到该文件被写入 |
| 4 ⛔八点确认 | BLOCKING | 人在回路回调（见第 5 节） |
| 5 生图 | `image_gen.py` / `image_search.py` | hook 捕获，可显示"生成第 N 张图" |
| 6 逐页 SVG | Executor 逐页写 `svg_output/*.svg` | hook 监听该目录新增文件，每页推一次 `page N/total` |
| 7 质检 | `svg_quality_checker.py` | hook 捕获 |
| 8 后处理导出 | `finalize_svg.py` → `svg_to_pptx.py` | hook 捕获，完成后推送 pptx 就绪 |

前端用 **WebSocket / SSE** 接收这些事件，渲染成时间线 + 当前页缩略图。第 6 步是耗时大头，逐页推流能让用户看到"正在生成第 3 页"的真实感。

---

## 5. 人在环路：把"八点确认"搬到 Web（最关键的产品设计）

ppt-master 的 Step 4 是 ⛔ BLOCKING——agent 必须停下来等用户确认模板/格式/页数/配色/字体/图片策略等八项。在本地 IDE 里是聊天等待，在 Web 上这样实现：

1. **暂停点**：给 Agent SDK 注册一个**自定义工具** `request_design_confirmation(spec_json)`。当 agent 按 SKILL.md 走到确认环节时，让它调用这个工具（而不是停下干等）。
2. **挂起会话**：Worker 收到该调用后，把当前 `design_spec.md` 内容 + 八项推荐存入 Job 状态，**通过 SDK 的会话 resume 机制挂起会话**（保存 `sessionId`），向前端推一个"待确认"事件。
3. **前端确认面板**：用户在网页上看到推荐方案，可逐项改（页数、主色、风格模板、是否 AI 生图…），点"确认/修改"。
4. **恢复会话**：Worker 把用户的确认作为一条 user message 注入，`--resume <sessionId>` 继续，agent 接着跑后续非阻塞步骤直到导出。

> SDK 的 `--resume` 让"暂停等人类"在工程上完全可行，不必重跑前面的步骤。这是选 Agent SDK 而非裸 API 的核心理由之一。

---

## 6. 项目隔离与安全沙箱（多租户必做）

agent 有执行任意命令的能力，多租户场景**必须锁死**，否则是灾难：

- **文件隔离**：每个用户 / 每个 Job 一个独立项目目录，Agent SDK 的 `cwd` 限定在该目录。
- **命令白名单**：通过 SDK 权限设置 / PreToolUse hook，**只允许执行 ppt-master 的脚本命令**，拒绝其他 Bash。文件读写 hook 拦截项目目录之外的路径。
- **进程隔离**：MVP 用独立子进程 + 受限用户；正式版用 **Docker 容器 / gVisor**，每个 Job 一个临时容器，跑完销毁，限制 CPU / 内存 / 磁盘 / 网络（生图需要外网，其余可禁）。
- **密钥隔离**：AI 模型 key、生图 key 放服务端 `.env`，**绝不下发到前端**；用户配额在服务端计量。

---

## 7. 数据模型与历史/保存

```
users(id, email, password_hash, quota_credits, role, created_at)
projects(id, user_id, name, canvas_format, status, created_at, updated_at)
  └ 一个 project = 一份 PPT，对应 ppt-master 的一个 projects/<x> 目录
jobs(id, project_id, type[new|tune], status[pending|running|awaiting_confirm|
     done|failed], agent_session_id, current_stage, error, cost_tokens, ...)
sources(id, project_id, filename, storage_key, kind[pdf|docx|text|url])
spec_confirmations(id, job_id, spec_json, user_response, created_at)
versions(id, project_id, pptx_key, svg_snapshot_key, design_spec_key,
         created_at)  └ 每次导出一个版本，对应 ppt-master 的 backup/<ts>/
```

- **保存**：每次成功导出写一个 `version`，pptx + svg 快照 + design_spec 全入对象存储，DB 存指针。
- **历史**：`projects` 列表按用户聚合，每个 project 下有多个 version，可回溯 / 再下载 / 再调优。
- ppt-master 本身已经把 `svg_output/` 镜像到 `backup/<timestamp>/`，直接复用这个机制做版本管理。

---

## 8. 调优能力（生成完之后）

这是"工具不是许愿池"的落地，三档能力：

1. **全局调整**：改配色 / 字体 / 风格 → 复用 ppt-master 的 `update_spec.py`（把 `spec_lock.md` 的改动同步到所有已生成 SVG）+ 重新导出。前端一个"换肤"面板即可。
2. **逐页重做**：用户选中第 N 页，输入"改成两栏 / 换张图 / 精简文字"→ 起一个（或 resume）Agent 会话，cwd=项目目录，指令让它只重写该页 SVG + 重新导出。
3. **可视化批注**：ppt-master 自带 `live-preview` 工作流和 `svg_editor/server.py`。前端内嵌 SVG 预览，用户在页面上圈选 / 批注，批注通过 `check_annotations.py` 既有机制回传给 agent，agent 据此修改。**这是体验差异化的杀手锏**——所见即所得地指挥 AI 改 PPT。

---

## 9. 登录与权限

- 用 **better-auth / NextAuth / FastAPI-Users** 做邮箱密码 + OAuth（GitHub/Google）。
- JWT 会话，API 网关校验。
- 配额：按 token / credits 计量（见第 10 节），每个 Job 预扣、结算后退补。
- 管理后台：用户管理、Job 监控、成本看板。

---

## 10. 成本与计费（必须正面面对）

ppt-master 官方就推荐 **Claude Opus + gpt-image-2**，一份 10 页 deck 单次生成成本可能 $5–20，且 Executor 要求单会话逐页连续生成，又长又贵。产品设计要点：

- **模型分层**：Strategist / Executor 用 Opus 或 Sonnet；素材解析、质检、后处理等确定性步骤尽量用 Haiku 或直接跑脚本不调模型。
- **预览即扣费**：进入生成前展示预估 token / credits，用户确认才扣。
- **配额与套餐**：免费额度 + 充值 credits；按实际 token 结算。
- **缓存复用**：调优时复用已有 SVG / spec，只重做变化部分，省钱省时。
- **降级选项**：允许用户选 Sonnet / Gemini Flash 等便宜模型，明确告知质量上限会下降（作者原话："效果不理想先换模型，别质疑 harness"）。

---

## 11. 技术栈建议

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | Next.js + React + Tailwind + shadcn/ui | 生态成熟，SSR + API 一体 |
| 实时通信 | WebSocket (Socket.io) 或 SSE | 进度 / 确认推送 |
| 后端编排 | **Python FastAPI** + **Claude Agent SDK (Python)** | 与 ppt-master 的 Python 生态、.env、脚本天然合一 |
| 任务队列 | Celery + Redis（或 RQ） | 长时 Job、worker 池 |
| 数据库 | PostgreSQL | 元数据 / 历史 / 配额 |
| 对象存储 | S3 / MinIO | pptx / svg / 源文件 |
| 沙箱 | Docker（每 Job 一容器） | 隔离 agent 执行 |
| SVG 预览 | 复用 ppt-master `viewer.html` 逻辑 | 不重复造轮子 |

> 若团队更熟 TS，编排层也可用 Node + Agent SDK (TS)，Worker 仍 shell 调 Python 脚本。但**单语言（Python）更省心**，推荐。

---

## 12. 关键风险与决策点

1. **长会话稳定性**：Executor 要求单 agent 逐页连续生成，10+ 页会话可能很长，存在超时 / 上下文压缩漂移风险。→ 需做会话保活、断点 resume、超长 deck 拆 Phase A/B（ppt-master 自带 `resume-execute` 工作流，正好用上）。
2. **成本不可控**：见第 10 节，必须有配额和分层。
3. **多租户安全**：见第 6 节沙箱，没做隔离前不能上线。
4. **版权 / 署名**：网络搜图可能需署名，ppt-master 会自动加小字署名；产品要明确告知用户。
5. **是否一上来就多租户**：若先自用 / 小范围，可跳过容器沙箱，单机跑通即可。

---

## 13. 落地路线

- **Phase 0 — 验证（1–2 周）**：本地写一个 Python 脚本，用 Agent SDK 跑通"输入文字 → 跑完整 ppt-master skill → 出 pptx"，把进度 hook 和八点确认暂停 / 恢复跑通。**这是整个方案的技术风险点，先验证它。**
- **Phase 1 — MVP（2–4 周）**：单用户、本地部署。FastAPI + 简单前端，支持上传 / 输入、进度、确认、下载、历史列表。不做计费、不做容器。
- **Phase 2 — 多租户（3–6 周）**：登录、配额、Docker 沙箱、对象存储、逐页调优与可视化批注。
- **Phase 3 — 商业化**：计费套餐、模型分层、管理后台、性能优化。

---

## 附：关键依赖与参考

- **ppt-master 核心**：`skills/ppt-master/SKILL.md`（主流程权威）、`skills/ppt-master/scripts/`（脚本工具）、`skills/ppt-master/workflows/`（独立工作流：resume-execute / live-preview / topic-research / template-fill 等）。
- **Claude Agent SDK**：Python / TypeScript，提供 hooks、权限、MCP、会话 resume。
- **ppt-master 已内置可直接复用的能力**：
  - 进度相关：`confirm_ui/server.py`（八点确认可视化页）、`svg_editor/server.py --live`（实时预览 + 批注）、`check_annotations.py`（批注回传）。
  - 调优相关：`update_spec.py`（全局换肤）、`resume-execute` 工作流（断点续跑）、`visual-review` 工作流（视觉自检）。
  - 版本相关：`backup/<timestamp>/svg_output/` 自动镜像。
