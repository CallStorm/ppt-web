# 新建任务界面改版（作曲式 Composer）设计

日期：2026-06-24
范围：把 `webui/src/pages/NewJobPage.tsx` 从一长串下拉表单重构为分节折叠的作曲式编辑器；用 CSS 视觉控件替代抽象的 `<select>`/单选组（无缩略图资产、无新后端字段）。

## 背景

当前 `NewJobPage` 是单栏纵向平铺，~625 行，11 个 `<select>`/单选组 + 3 个 textarea + 1 个文件上传 + 智能填充按钮，密度过高、不分组、视觉抽象（「瑞士极简」「震撼」让用户盲选）。卡片化/色谱化建议需要设计资产（每种风格一张缩略图）——目前没有，做不了真正的缩略图。

## 目标

- 把表单拆为 3 个逻辑折叠分组（内容源 / 视觉调性 / 素材策略），高级移到底部齿轮。
- 视觉风格、色配、图片策略用纯 CSS 视觉控件（chip 网格 / 配色色谱 / 卡片），无图片资产。
- 加一个轻量的客户端 AI 提示气泡（关键词触发，无 LLM 调用）。
- 暗色模式深化这页的"画布感"，但保持应用全局主题。

## 决策（已与用户确认）

1. **Tier A only**：本次只做无新资产、无新后端的改动（折叠分节 / 色谱 / 卡片 / 提示气泡 / 暗色深化）。Tier B（缩略图 / 实时画布 / 动画）单独立项，先做资产。
2. **同一页重构**（Approach 1）：单页单栏，但分节 + 折叠。无右侧画布、无全屏"演示模式"。

---

## 1. 布局

### 1.1 三个折叠分组

```
┌──────────────────────────────────────────┐
│  创建任务                       [取消]    │  ← 顶部条
├──────────────────────────────────────────┤
│  ▼ ① 内容源                              │  ← 默认展开
│     [项目名（可省）]                       │
│     [主题输入 | 文档输入] 模式切换          │
│     [核心主题 textarea]                    │
│     [✨ AI 智能填充 按钮]                  │
│     [💡 AI 提示气泡 — 关键词触发]           │  ← 新
│                                          │
│  ▶ ② 视觉调性                            │  ← 默认折叠
│     [5 个基础字段：语言/场景/受众/语调/页数] │  ← 从 ① 移过来
│     [视觉风格 chip 网格]                   │  ← 新控件
│     [配色模式 pill + 配色色谱带]            │  ← 新控件
│                                          │
│  ▶ ③ 素材策略                            │  ← 默认折叠
│     [图片策略 pill 卡片网格]               │  ← 新控件
│                                          │
│  ⚙ 高级（画布 / 叙事模式 / 图标 / 公式 / 备注）│  ← 底部齿轮
│  [展开时内嵌面板]                          │
├──────────────────────────────────────────┤
│  [创建任务 (primary, 全宽)]               │  ← 行内（非 sticky）
└──────────────────────────────────────────┘
```

### 1.2 行为

- ① 始终展开；② ③ 默认折叠。
- ② ③ 高级 三者互不依赖，可任意组合展开。
- `autoFill` 成功后自动展开 ②（让用户看到 AI 选了什么），不自动收。
- 折叠状态用本地 `useState`（不持久化）。
- 移动端（`< sm`）全部展开（折叠太挤）。
- 提交按钮在底部行内（不 sticky；YAGNI）。

### 1.3 暗色"画布感"（Tier A 内）

不动全局主题。用现有 `dark:` 变体 + slate 色板深化本页：

| 元素 | 暗色处理 |
|---|---|
| 页面容器 | `dark:bg-gradient-to-b dark:from-slate-950 dark:to-slate-900`（细微纵向渐变） |
| 三个分组卡片 | `dark:border-slate-800 dark:bg-slate-900/40`（半透明磨砂面板） |
| 章节标题按钮 | `dark:text-slate-200 dark:hover:bg-slate-800/50` |
| 视觉风格 chip 卡 | 彩色 swatch 保留（"幕布"），卡背景 `dark:bg-slate-900/60` |
| 配色色谱 swatch | `dark:ring-1 dark:ring-slate-700`（让色块在暗底浮起来） |
| AI 提示气泡 | `dark:bg-slate-900/60 dark:border-slate-800` |
| 亮色模式 | 同样卡片化 `bg-white/80 border-slate-200`（光感） |

无新色板 token、无新暗色开关。

---

## 2. 视觉控件

### 2.1 视觉风格 — chip 网格（替换 `visual_style` `<select>`）

**数据：** 新增 `VISUAL_STYLE_SWATCH: Record<JobVisualStyle, { bg: string; glyph: ReactNode }>`（在 `jobOptions.ts` 末尾或新文件 `webui/src/lib/styleSwatches.tsx`）。swatch 是纯 CSS —— 一个渐变 + 1-2 个色块/线段/形状，**不是**真实缩略图。

| value | 标签 | swatch 元素 |
|---|---|---|
| `auto` | AI 智能感知 | 软渐变 + ✨ glyph（默认柔和脉冲） |
| `swiss-minimal` | 瑞士极简 · 企业内训首选 | slate-50 底 + 黑色矩形 |
| `glassmorphism` | 玻璃拟态 · 现代科技 | cyan/purple 渐变 + 白色模糊块 |
| `dark-tech` | 深色科技 · 技术发布 | slate-900 底 + emerald-400 发光线 |
| `brutalist` | 粗野主义 · 重磅发布 | yellow-300 底 + 黑色粗边方块 |
| `editorial` | 编辑设计 · 内容型 | stone-100 底 + 两条 stone-900 文字条 |
| `blueprint` | 蓝图 · 工程方案 | blue-50 + 蓝色细线网格 + 边框 |
| `photo-editorial` | 图册编辑 · 大图主导 | amber-100 + 大的 amber-700 图片块 |
| `soft-rounded` | 柔圆亲和 · ToC/教育 | pink-50 + 两个圆角粉块 |
| `data-journalism` | 数据新闻 · 图表密集 | orange-50 + 两条 orange-500 柱状 |
| `memphis` | 孟菲斯 · 创意营销 | yellow-100 + 三个小色块（圆/三角/线） |

**布局：** `grid-cols-2 sm:grid-cols-3` 网格；12 张卡（11 + auto）。每张卡 ~60px 高 swatch + label + 一行 tagline。**选中：** `border-gemini-500` + 角标 ✓。**hover：** `hover:-translate-y-0.5 hover:shadow-md`。
**`auto` 选中时（且 core_topic 非空）：** 卡内右下角显示小 chip "AI 已根据内容自动选择"。

### 2.2 配色 — pill 模式 + 配色色谱带（替换 `color_mode` 单选 + brand/industry 输入）

**数据：** 新增 `COLOR_PALETTE: Record<ColorPaletteKey, { swatches: string[]; label: string }>`。
- key = `auto` | `brand` | 7 个 `industry`。
- 每条 4 个 swatch（Tailwind 色 token 字符串数组）+ 1 行业 4 个 hex。

**布局：**
```
[ auto ] [ 品牌色 ] [ 行业预设 ]   ← pill 按钮（替换原 radio）
─────────────────────────────────
● ● ● ●   AI 智能感知主调          ← 4 个圆 + 标签
─────────────────────────────────
[HEX 输入 + 格式提示]  ← 仅 brand 模式显示
[行业下拉，每行右侧 4 点预览]  ← 仅 industry 模式显示
```

**品牌色 swatch 算法：** 用户输入 `#RRGGBB` 后取 4 色——主色（输入）+ 副色（hue 旋转 +30°）+ 浅色（L 0.85）+ 深色（L 0.2）。前端用 `color-mix` 或 HSL 字符串拼接即可。输入实时联动色谱。

**行业 4 色（hex）：**
- finance 海军蓝：`#003366 #4A6FA5 #B0C4DE #F0F4F8`
- technology 鲜亮蓝：`#1565C0 #42A5F5 #90CAF9 #E3F2FD`
- healthcare 青绿：`#00796B #4DB6AC #80CBC4 #E0F2F1`
- government 中国红：`#C41E3A #E57373 #FFCDD2 #FFF5F5`
- education 学术深蓝：`#1A237E #5C6BC0 #9FA8DA #E8EAF6`
- retail 暖橙：`#E65100 #FF9800 #FFCC80 #FFF3E0`
- creative 多色：`#E91E63 #FFC107 #03A9F4 #8BC34A`

**行业下拉增强：** 在 `INDUSTRY_OPTIONS` 旁边展示该行业的 4 点预览（小圆 swatch）。如果原生 `<option>` 难做，可改成自定义下拉（button + listbox）—— 见 §4 风险。

### 2.3 图片策略 — pill 卡片网格（替换 5 个单选）

保留原 5 个 `IMAGE_STRATEGY_OPTIONS`，仅改渲染：从 radio grid 升级为 2 列 pill 卡片网格：
- 🌐 网络搜图（默认，速度快）
- 📎 仅使用上传的图片
- ◼ 占位符/纯色块
- 🚫 不使用图片
- ✨ AI 生图（需配置 key，可能失败）

glyph 是纯 SVG（lucide 图标库或内联）。选中态：gemini border + bg tint，沿用今天 JobCard 的 radio 卡样式（保持视觉一致）。

### 2.4 AI 提示气泡（关键词触发，无 LLM）

**新文件 `webui/src/lib/aiHints.ts`：**
```ts
export const AI_HINTS: { keywords: string[]; text: string }[] = [
  { keywords: ['商业', 'BP', '商业计划', 'pitch'], text: '💡 检测到商业计划书，建议补充『市场痛点』和『盈利模式』章节' },
  { keywords: ['产品', 'product', '发布', 'launch'], text: '💡 产品发布？建议突出『核心价值』和『目标用户』' },
  { keywords: ['技术', '架构', 'architecture', '系统设计'], text: '💡 技术方案？建议加入『架构图』和『对比基准』' },
  { keywords: ['数据', '报告', 'data', 'report'], text: '💡 数据报告？『关键发现』和『行动建议』会更抓眼球' },
  { keywords: ['教学', '培训', '教程', 'training', 'tutorial'], text: '💡 教学类内容？『学习目标』和『小结』能帮学员抓住重点' },
]

export function pickHint(text: string): string | null {
  const t = text.toLowerCase()
  for (const h of AI_HINTS) if (h.keywords.some(k => t.includes(k.toLowerCase()))) return h.text
  return null
}
```

**位置：** ① 内容源 分组内，核心主题 textarea 下方，智能填充按钮上方。文字 `text-xs text-slate-500 dark:text-slate-400`，无需边框（只是提示，不是模态）。

**诚实声明（写在 spec 里）：** 这是确定性关键词触发，**不是**真实 LLM 调用。前端文案写"AI 提示"是因为整个产品的智能填充本身就是 AI，这个气泡是其轻量兄弟。不向用户强调是 LLM。

---

## 3. 重命名与字段迁移

### 3.1 标签重命名
- `auto（AI 推荐）` → `AI 智能感知`（仅 `VISUAL_STYLE_OPTIONS` 的 label 字段；value `auto` 不变，`applyStyle` 现有逻辑不需要改）。
- 章节标题 `② 内容输入` → `① 内容源`。
- 高级展开按钮文本 `高级（画布 / 模式 / 图标 / 公式 / 备注）` → `⚙ 高级（画布 / 叙事模式 / 图标 / 公式 / 备注）`（加齿轮 glyph + "模式" 改 "叙事模式" 以与 `MODE_OPTIONS` 一致）。

### 3.2 5 字段从 ① 移到 ②
语言 / 场景 / 受众 / 语调 / 页数从 ① 移到 ② 顶部（紧凑横排，`flex-1 min-w-[6rem]`，用现有 `<OptionSelect>` 组件）。原"推荐设置"子标签去掉。功能零变化（autofill 仍写入它们）。

---

## 4. 风险与决策

### 4.1 `<option>` 内嵌 swatch
原 `<select>` 的 `<option>` 不能内嵌 HTML（部分浏览器会渲染为纯文本），所以行业下拉的"每行右侧 4 点预览"无法用原生 `<select>`。两条路：
- **A. 改成自定义下拉**（button 触发 + listbox）—— 干净，但多写一个下拉组件。
- **B. 放弃下拉增强**——在所选行业旁边显示 4 点 swatch（在 pill 行下方），下拉保持原生。简单。
- **推荐 B**：少一个组件，视觉增强仍然到位（用户选了之后立刻看到 swatch）。spec 默认按 B 实现。

### 4.2 swatch 设计的"是否够有诚意"
纯 CSS swatch 不是真缩略图，可能让用户觉得"花哨但不真"。spec 接受这个 trade-off（Tier A 不做资产）。如果 review 时觉得 swatch 太平庸，可在 plan 阶段决定改用 SVG inline 装饰更复杂图形；spec 不锁定具体像素。

### 4.3 关键词触发的英文覆盖
`aiHints.ts` 的关键词列表偏中文（业务上下文）。如果用户输入全英文，命中率低。这是已知接受——提示气泡是 nice-to-have，不命中就静默。

### 4.4 `auto` 卡片在内容为空时的状态
`auto` 选中 + `core_topic` 空：swatch 仍可见（脉冲渐变），但不显示"AI 已根据内容自动选择" chip（条件：core_topic.trim() 长度 > 0）。

---

## 5. 影响文件

**新建**
- `webui/src/lib/aiHints.ts` —— 关键词 map + `pickHint()`。

**修改**
- `webui/src/lib/jobOptions.ts` —— 追加 `VISUAL_STYLE_SWATCH` + `COLOR_PALETTE`；改 `auto` 标签为 `AI 智能感知`。
- `webui/src/pages/NewJobPage.tsx` —— 三折叠分节 + 高级齿轮 + chip 网格 + 配色色谱 + pill 卡片 + AI 提示气泡 + 暗色深化。预计 625 → 750-800 行。

**不变**
- `JobOptions` 类型（无新字段）。
- 后端所有路由 / 字段。
- `JobCard` / `DashboardPage` / `StatusPill` / `CoverPlaceholder` / `FileUploadZone` 等。
- 智能填充端点 `/api/app/llm/auto-fill`。
- 文案：核心主题 / 大纲 / 重点 textarea 完全保留。

## 6. 非目标

- 无新 `JobOptions` 字段；无新 enum 值；无后端改动。
- 无真实缩略图（Tier B，待资产）。
- 无右侧实时画布。
- 无动画编排（提交后页面跳转 `JobDetailPage`，动画属于那页）。
- 无全屏"演示模式"叠加层。
- 无折叠状态持久化。
- 行业下拉不做每行 swatch 增强（用 spec §4.1 B 方案：选中后旁路显示）。
- `auto` chip 的"AI 自动锁定"动画不做（仅 chip 文字 + 视觉标记）。
