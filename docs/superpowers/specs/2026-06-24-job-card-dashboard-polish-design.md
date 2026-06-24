# 作品卡片与仪表盘体验优化设计

日期：2026-06-24
范围：作品卡片（JobCard）、仪表盘（DashboardPage）、导航栏（AppShell）的视觉/交互打磨 + 失败任务重试（后端新增）。

## 背景

当前作品列表存在三类体验问题：

1. **状态展示不一致** —— 卡片底栏按状态分支渲染：`done` 卡片底栏放「预览/下载」图标按钮，非 `done` 卡片底栏放状态药丸。导致不同状态卡片底部布局不齐、视觉凌乱。
2. **操作按钮常驻** —— 完成卡片的图标按钮一成不变，卡片多时增加视觉噪音。
3. **空封面/加载态缺失** —— 运行中/失败任务无封面时直接显示纯白/纯灰方块（如「AI 知识库」空白卡），首屏加载只有「加载中…」文字，缺少骨架。
4. **筛选/搜索细节粗糙** —— 状态筛选是纯文本标签、点击热区小；数量 `11/11` 孤立放在右侧；圆角语言不统一。
5. **导航栏按钮冲突** —— 管理后台的浅黄色背景与「创建」的亮蓝色冲突；右侧 credits/theme/登出 元素拥挤。
6. **失败任务无重试** —— 失败仅显示「失败」标签，无重试入口，也无失败原因。

## 目标

- 统一卡片底栏布局：所有状态在同一位置有明确状态标识。
- 操作按钮默认隐藏，悬停淡入。
- 空封面与加载态有优雅占位图。
- 筛选做成胶囊分段控件、数量并入标题。
- 导航栏次要按钮降级为描边、右侧间距拉开。
- 失败/取消任务可一键重试（原地复位，复用上传文件，重新计费 1 credit）。

---

## 第 1 节：卡片布局（核心）

采用 **Approach A：状态常驻 + 操作按钮悬停浮层**。

### 底栏（所有状态一致）

```
┌──────────────────────────────────────────┐
│  [缩略图 — 见下]                          │
├──────────────────────────────────────────┤
│  市场推广季度汇报              ●完成  ⋮   │  ← 标题(truncate) | StatusPill | 更多菜单
│                              AI服务超时…   │  ← 错误行：仅 failed/cancelled
└──────────────────────────────────────────┘
```

- **标题**（`truncate`、`flex-1`）→ 链接到详情页。
- **StatusPill**（`shrink-0`）：所有状态都显示。done=绿「完成」、failed=红「失败」、cancelled=灰「已取消」、running=蓝脉冲「运行中」、queued=灰「排队」、paused=琥珀「待确认」。
- **更多菜单（⋮）**：始终存在。含 **删除**（所有状态）+ **重试**（仅 failed/cancelled）。重试不在底栏常驻，保持底栏安静；失败的醒目重试入口放在缩略图悬停浮层与错误行。
- **错误行**：标题下一行，仅当 `status ∈ {failed, cancelled}` 且 `error_message` 非空时显示。单行截断、muted rose 色。cancelled 任务若 `error_message` 为通用 `"user cancelled"` 则显示「用户取消」。

### 缩略图悬停浮层（Approach A）

```
┌─────────────────────────────┐
│  [封面 / 占位图]         ┌──┐│
│                          │👁 ⬇││  ← 操作 chip，group-hover 淡入
│                          └──┘│
└─────────────────────────────┘
```

- 默认：封面图（或占位图，第 2 节），无按钮。
- `group-hover` 时在缩略图**右上角**淡入一个小半透明 chip，按状态提供快捷操作：
  - **done**：👁 预览、⬇ 下载（有 pptx 时）
  - **failed/cancelled**：↻ 重试
  - **running/queued/paused**：无 chip（运行中无可执行操作，管理走详情页）
- chip 的预览按钮打开既有 `SlidePreviewModal`；下载、重试触发各自 handler。全部 `stopPropagation`，不触发卡片导航。
- 浮层默认 `pointer-events-none`，悬停后才可交互，不遮挡封面其余区域的点击进详情。

### 状态药丸配色强化

- running：蓝 + 既有脉冲（保留）—— 加一个细微动态点表现「生成中」能量。
- paused「待确认」：琥珀（已实现）。
- cancelled：中性灰（已实现）。当前与 queued 同为 `slate-100/slate-800`，将 cancelled 调得更 muted 以区分。
- failed：rose（保留）。

这一统一底栏 + 浮层替换掉当前 `{isDone ? 图标按钮 : 药丸}` 的分支逻辑——那是「凌乱」的根因。

---

## 第 2 节：占位图与加载态

**目标**：永远不出现空白/纯白卡片；无封面时也显得有意为之。

### 三种封面状态（都落在既有缩略图框内）

1. **有预览 / done** → 封面图，同今天。
2. **running / queued / paused** → 生成中占位图，带轻微脉冲，非纯白方块。
3. **failed / cancelled** → 失败占位图（muted），表明卡片不是还在工作。

### 占位图设计

两类占位图都复用既有渐变背景（`colorFromId(job.id)` 着色），保证与卡片身份配色一致，叠加居中标记：
- **生成中**：低透明度品牌标识 + 细旋转环 + 状态文案（「生成中…」/「排队中」）。复用 `index.css` 已有的 `pulse-ring` 动画。
- **失败**：同渐变 + muted ⚠ + 「生成失败」——比红色泼墨更克制；红色留在药丸。

实现：缩略图渲染 `previewOk ? <img/> : <CoverPlaceholder status={...} />`，`CoverPlaceholder` 为新增的小组件（品牌标识 + 旋转环 + 状态文案），无新依赖、纯 CSS。扩展 `previewOk` 逻辑，使 running/queued 不再尝试 `<img>`（当前会尝试，显示破损/白方块——即所见「AI 知识库」空白）。

### 对齐修复

底栏改为统一 flex 行（第 1 节）后，药丸在每张卡片同一位置——所见「待确认」错位作为统一布局的副作用自然消失。无需绝对定位。

### 首屏骨架

`DashboardPage` 当前用纯文本「加载中…」。改为 6 张骨架卡（同 `aspect-video` + 底栏条 + shimmer），在数据到达前建立网格形状。用 `SkeletonCard` 组件 + CSS shimmer，与占位图语言一致。

---

## 第 3 节：筛选/搜索 + 导航栏

### 3a. 筛选改成分段控件

纯文本标签 → 胶囊分段控件（单个圆角容器 + 滑动式激活态），更大点击热区、更强可点击感。

```
┌───────────────────────────────┐
│  全部  运行中  完成  失败       │   ← 激活=实心 gemini-600，非激活=muted 文字
└───────────────────────────────┘
```

- 容器：`inline-flex rounded-full border bg-slate-50 p-0.5`，每项 `rounded-full px-3 py-1 text-xs`。
- 激活项：`bg-gemini-600 text-white`；非激活：`text-slate-500 hover:text-slate-800`。
- 抽取 `filters` 数组 + 激活态为小组件 `<StatusFilter value onChange>`，便于复用与测试。

### 3b. 数量并入标题

```
我的作品 (11)          ← 有筛选/搜索时显示：我的作品 (3/11)
```

- 标题行显示 `我的作品` + `(N)` 总数，或 `(shown/total)`（筛选/搜索缩减集合时）——数字始终反映当前所见。
- 移除右侧旧 `11/11`（已冗余）。
- 移除既有 `共 N 个作品` 副标题以减少冗余；数量并入标题。

### 3c. 圆角统一

审计圆角：搜索框（`rounded-md`）、筛选容器（`rounded-full`）、创建按钮（`rounded-md`）、导航栏按钮（`rounded-md`）。决定：**胶囊形控件**（筛选分段、credits 徽章）保持 `rounded-full`；**矩形输入/按钮**（搜索、创建、管理后台）统一 `rounded-md`。今天的「不统一」实为筛选标签是无样式文本，而非圆角冲突——分段控件解决之。无需全局圆角大改，仅确保搜索框与按钮都用 `rounded-md`（已是）。

### 3d. 导航栏「管理后台」按钮

从琥珀实心降级为**描边按钮**，不再与蓝色「创建」冲突：

```
[创建]   [管理后台]              ← 创建: 实心 gemini-600; 管理后台: 描边 + 透明底, slate 文字
```

- 新样式：`rounded-md border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-100`（含 dark 变体）。读作次要动作。
- 位置不变（左侧导航）——它是顶级导航目的地；移到头像旁改动过大，描边化即可。

### 3e. 导航栏 credits 间距

右侧簇（`email · credits · theme · 登出`）拥挤。调整：
- credits 徽章保持胶囊样式，但内部数字前加一个 ◆/金币字形（当前无图标）；右侧簇 `gap-3` → `gap-4`，让 credits 徽章、主题切换、登出 呼吸。
- 保留既有 `88 credits` 胶囊样式——只加图标与间距。

---

## 第 4 节：重试（原地复位，复用上传文件）

### 接口

`POST /api/jobs/{job_id}/retry` —— 仅 owner/admin。

### 行为（原地复位，已确认选项 #1）

1. **状态守卫**：仅 `failed` 与 `cancelled` 可重试。其他状态返回 `409`（非 400），message `"job status is {status}, can only retry failed/cancelled jobs"`。
2. **重新计费**：重扣 `quota_credits` 1。≤0 返回 `402 quota exhausted`（同 `create_job`）。**owner 始终支付 1 credit**，无论谁触发（admin 重试别人的任务，owner 付费）——已确认选项 #1。
3. **复位行**（单事务）：
   - `status = "queued"`
   - `error_message = None`
   - `session_id = None`（失败任务可能有死 session；全新 `run_job` 干净启动——**绝不用 `resume_job`**，它需活 session）
   - `pptx_path = None`
   - `cost_usd = 0`（重新计账；失败 run 的 cost 已在失败时退款）
   - `project_dir = None`（让 `run_job` 重新赋值）
   - `pending_confirm = None`
   - `prompt`、`project_name`、`options_json`、`user_id` 不变
4. **清理旧产物**：`shutil.rmtree(project_root_for(user_id, job_id), ignore_errors=True)`，让 runner 从干净 project dir 启动。runner 会重新 `mkdir`。
5. **复用上传文件**：对 uploads 目录**什么都不做**——`_collect_upload_paths` 在 dispatch 时重扫，原上传文件自动被重新拾取。（已确认：失败任务的上传文件留存；仅 `DELETE` 删除它们。）
6. `notify_dispatcher()`，让 `queued` 任务被拾起。
7. 返回 `{ id, status: "queued" }`。

### 为何 run_job 而非 resume_job

`resume_job` 需有效 `session_id` 传 `--resume`。失败任务的 session 已死/缺失。重试是从相同 prompt+options+uploads 的全新生成——正是 `run_job(prompt, project_name, upload_paths=...)` 所做。dispatcher 已将非 `pending_confirm` 行路由到 `run_job`，故只需 `status=queued` + `notify`，无需新 dispatch 代码。

### Credit 退款交互（重要，有意识的决定）

runner 在**runner-exception** 失败（`except` 分支）与 `final["refund"]` bail 时退款 1 credit；但跑到完成却未出 pptx 的失败（`status=failed`、无异常）**不退款**。含义：
- 用户对原始失败 run 可能退、可能未退。
- 重试无论哪种都收 1 credit。

这是正确、简单的行为：每次尝试 1 credit。**不**去检测「原始是否已退」——那会过度复杂化路径。

### 前端

- **Hook**：`useRetryJob()` —— `useMutation` 调 `POST /api/jobs/{id}/retry`，成功后 invalidate `JOBS_KEY`（列表）+ `jobKey(id)`（详情）。列表重取后卡片翻转为 running/queued 药丸。
- **卡片入口**：
  - failed/cancelled 卡片在缩略图悬停 chip（第 1 节）放 **↻ 重试**，且在更多菜单加「重试」条目（非悬停也可达，如触屏）。
  - 重试 mutation pending 时按钮显示旋转、禁用。
- **无 toast**（已确认选项 #1，非 #3）——卡片自身状态变化即反馈。

---

## 影响文件清单

**前端**
- `webui/src/components/jobs/JobCard.tsx` —— 底栏重构、悬停浮层、错误行、重试入口。
- `webui/src/components/jobs/StatusPill.tsx` / `webui/src/index.css` —— 配色强化、cancelled 与 queued 区分、running 动态点。
- `webui/src/components/jobs/CoverPlaceholder.tsx`（新）—— 生成中/失败占位图。
- `webui/src/components/jobs/SkeletonCard.tsx`（新）—— 首屏骨架。
- `webui/src/components/jobs/StatusFilter.tsx`（新）—— 胶囊分段控件。
- `webui/src/pages/DashboardPage.tsx` —— 数量并入标题、接入 StatusFilter、骨架、移除旧数量。
- `webui/src/components/layout/AppShell.tsx` —— 管理后台描边化、credits 图标 + 间距。
- `webui/src/hooks/useJobs.ts` —— `useRetryJob`。

**后端**
- `backend/api/routes/jobs.py` —— 新增 `POST /{job_id}/retry`。

## 非目标

- 不做 admin 重试免费（选项 #2，已否）。
- 不做 toast 反馈（选项 #3，已否）。
- 不做 clone-to-new-job 重试语义（选项 #2，已否）。
- 不全局重做圆角系统。
- 不为重试做「原始是否已退」检测。
- 不改变失败任务退款逻辑。
