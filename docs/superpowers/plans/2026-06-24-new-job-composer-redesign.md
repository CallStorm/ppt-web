# 新建任务界面改版（作曲式 Composer）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `webui/src/pages/NewJobPage.tsx` from a single-column flat form into a 3-section collapsible composer with pure-CSS visual controls (style chips, color palette strip, image-strategy pill cards) and a keyword-triggered AI hint bubble. Deeper dark-mode "canvas" feel. No schema change, no new enum values, no backend touches.

**Architecture:** Pure frontend refactor. One new file (`aiHints.ts`) for the rule-based hint. Append `VISUAL_STYLE_SWATCH` + `COLOR_PALETTE` constants to `jobOptions.ts` (label rename for `auto` is the only enum-related change). Extract 3 small visual control components into their own files (`VisualStyleChips`, `ColorPaletteStrip`, `ImageStrategyCards`) to keep `NewJobPage` focused on layout/state. Rewrite `NewJobPage` to compose them.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (`@apply` and `@theme` already configured in `index.css`), TanStack Query v5.

## Global Constraints

- **No test framework in this repo** (no vitest, no jest). Verification = `cd webui && npm run build` (tsc -b && vite build) + `npm run lint`, run inside WSL with Node v24: `wsl bash -lc 'source ~/.nvm/nvm.sh && nvm use v24.11.1 && cd /home/dministrator/ppt-web/webui && <cmd>'`. The build catches `@apply` class errors; ESLint catches unused imports. There are ~8 PRE-EXISTING `react-hooks/*` errors in other working-tree files (`AiOptimizeButton`, `useJobEvents`, `AdminPage`, `JobDetailPage`) — out of scope, do NOT touch them; ensure YOUR touched files are lint-clean.
- **No new `JobOptions` fields, no new enum values, no backend changes.** Only the `auto` label in `VISUAL_STYLE_OPTIONS` is renamed to `AI 智能感知` (label only, value unchanged). The `applyStyle` logic in `NewJobPage` (which checks `s.visual_style === 'auto' ? 'auto' : ...`) stays correct.
- **No real thumbnail assets.** The visual_style "swatches" are pure-CSS chips (gradient + a couple of colored blocks), not real cover images. Same for color strips (Tailwind color tokens / hex).
- **No LLM call from the AI hint bubble.** `aiHints.ts` is deterministic keyword matching; spec is honest about this. No new endpoint.
- **Industry dropdown does NOT get per-row swatch** (spec §4.1 option B). The dropdown stays as a native `<select>`; the 4-swatch palette appears next to/below the selected industry, after the user picks.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Commit only the files a task touches. Leave unrelated working-tree noise (docker `.sh` exec bits, `ppt-master` submodule, pre-existing webui lint errors in untouched files) unstaged.
- DRY/YAGNI: extract reusable visual controls into their own files. Keep `NewJobPage` focused on layout + state.

**Spec reference:** `docs/superpowers/specs/2026-06-24-new-job-composer-redesign-design.md`

---

## File Structure

**Create**
- `webui/src/lib/aiHints.ts` — keyword map + `pickHint()`.
- `webui/src/components/jobs/VisualStyleChips.tsx` — visual_style chip grid.
- `webui/src/components/jobs/ColorPaletteStrip.tsx` — color_mode pill + palette strip + brand/industry inline controls.
- `webui/src/components/jobs/ImageStrategyCards.tsx` — image_strategy pill-card grid.

**Modify**
- `webui/src/lib/jobOptions.ts` — append `VISUAL_STYLE_SWATCH` + `COLOR_PALETTE`; rename `auto` option label to `AI 智能感知` (one line).
- `webui/src/pages/NewJobPage.tsx` — restructure as 3 collapsible sections + 高级 gear; compose the 3 new control components; dark-mode "canvas" treatment; AI hint bubble below core_topic; move 5 basic fields from ① to ② top.

**Unchanged**
- `JobOptions` type, all backend routes, `FileUploadZone`, all other components, all hooks.

---

### Task 1: Data — `aiHints.ts` + `jobOptions.ts` appends + label rename

**Files:**
- Create: `webui/src/lib/aiHints.ts`
- Modify: `webui/src/lib/jobOptions.ts` (append `VISUAL_STYLE_SWATCH` + `COLOR_PALETTE` at end; rename one label)

**Interfaces:**
- Produces: `pickHint(text: string): string | null` consumed by Task 4.
- Produces: `VISUAL_STYLE_SWATCH: Record<JobVisualStyle, { bg: string; glyph: ReactNode }>` consumed by Task 2 (the chip component).
- Produces: `COLOR_PALETTE: Record<ColorPaletteKey, { swatches: string[]; label: string }>` consumed by Task 3 (the strip component). `ColorPaletteKey` = `'auto' | 'brand' | JobIndustry`.

- [ ] **Step 1: Create `webui/src/lib/aiHints.ts`**

Create the file:

```ts
/** 关键词触发的轻量 AI 提示气泡（无 LLM 调用，确定性）。 */
export const AI_HINTS: { keywords: string[]; text: string }[] = [
  {
    keywords: ['商业', 'bp', '商业计划', 'pitch'],
    text: '💡 检测到商业计划书，建议补充『市场痛点』和『盈利模式』章节',
  },
  {
    keywords: ['产品', 'product', '发布', 'launch'],
    text: '💡 产品发布？建议突出『核心价值』和『目标用户』',
  },
  {
    keywords: ['技术', '架构', 'architecture', '系统设计'],
    text: '💡 技术方案？建议加入『架构图』和『对比基准』',
  },
  {
    keywords: ['数据', '报告', 'data', 'report'],
    text: '💡 数据报告？『关键发现』和『行动建议』会更抓眼球',
  },
  {
    keywords: ['教学', '培训', '教程', 'training', 'tutorial'],
    text: '💡 教学类内容？『学习目标』和『小结』能帮学员抓住重点',
  },
]

/** 返回第一条命中关键词的提示文案；无命中返回 null。 */
export function pickHint(text: string): string | null {
  const t = text.toLowerCase()
  for (const h of AI_HINTS) {
    if (h.keywords.some((k) => t.includes(k.toLowerCase()))) return h.text
  }
  return null
}
```

- [ ] **Step 2: Rename `auto` label in `jobOptions.ts`**

In `webui/src/lib/jobOptions.ts`, find the line:
```ts
  { value: 'auto', label: 'auto（AI 推荐）' },
```
(in `VISUAL_STYLE_OPTIONS`, first entry). Replace the `label` value with:
```ts
  { value: 'auto', label: 'AI 智能感知' },
```

- [ ] **Step 3: Append `VISUAL_STYLE_SWATCH` + `COLOR_PALETTE` to `jobOptions.ts`**

At the end of `webui/src/lib/jobOptions.ts` (after the `sanitizeJobOptions` function), append:

```tsx
import type { ReactNode } from 'react'

/* ── 视觉风格 swatch（纯 CSS，无真实缩略图） ── */
type SwatchSpec = { bg: string; glyph: ReactNode }

const swissRect = <div className="h-3 w-8 rounded-sm bg-slate-900" />
const glassCard = <div className="h-5 w-12 rounded-md bg-white/60 backdrop-blur-sm ring-1 ring-white/40" />
const darkLine = <div className="h-0.5 w-10 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
const brutalSquare = <div className="h-4 w-4 border-[3px] border-black" />
const editorialBars = (
  <div className="flex flex-col gap-0.5">
    <div className="h-1 w-10 bg-stone-900" />
    <div className="h-1 w-6 bg-stone-900" />
  </div>
)
const blueprintGrid = (
  <div className="h-7 w-12 border border-blue-500/60 bg-[linear-gradient(to_right,rgba(59,130,246,0.2)_1px,transparent_1px),linear-gradient(to_bottom,rgba(59,130,246,0.2)_1px,transparent_1px)] bg-[size:4px_4px]" />
)
const photoBlock = <div className="h-7 w-12 rounded-sm bg-amber-700" />
const softBlobs = (
  <div className="flex gap-1">
    <div className="h-5 w-5 rounded-full bg-pink-300" />
    <div className="h-4 w-4 rounded-full bg-pink-200" />
  </div>
)
const dataBars = (
  <div className="flex h-7 items-end gap-1">
    <div className="w-1.5 bg-orange-500" style={{ height: '60%' }} />
    <div className="w-1.5 bg-orange-500" style={{ height: '90%' }} />
    <div className="w-1.5 bg-orange-500" style={{ height: '45%' }} />
  </div>
)
const memphisShapes = (
  <div className="flex items-center gap-1">
    <div className="h-3 w-3 rounded-full bg-rose-400" />
    <div className="h-0 w-0 border-l-[5px] border-r-[5px] border-b-[8px] border-l-transparent border-r-transparent border-b-emerald-400" />
    <div className="h-0.5 w-6 rounded-full bg-violet-400" />
  </div>
)
const autoGlow = (
  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-gemini-300 to-violet-400 text-xs text-white">
    ✨
  </span>
)

export const VISUAL_STYLE_SWATCH: Record<JobVisualStyle, SwatchSpec> = {
  auto: {
    bg: 'bg-gradient-to-br from-gemini-100 via-violet-100 to-pink-100 dark:from-gemini-900/40 dark:via-violet-900/40 dark:to-pink-900/40',
    glyph: autoGlow,
  },
  'swiss-minimal': { bg: 'bg-slate-50 dark:bg-slate-800', glyph: swissRect },
  glassmorphism: {
    bg: 'bg-gradient-to-br from-cyan-200/60 to-purple-300/60 dark:from-cyan-900/40 dark:to-purple-900/40',
    glyph: glassCard,
  },
  'dark-tech': { bg: 'bg-slate-900 dark:bg-slate-950', glyph: darkLine },
  brutalist: { bg: 'bg-yellow-300 dark:bg-yellow-700', glyph: brutalSquare },
  editorial: { bg: 'bg-stone-100 dark:bg-stone-800', glyph: editorialBars },
  blueprint: { bg: 'bg-blue-50 dark:bg-blue-950', glyph: blueprintGrid },
  'photo-editorial': { bg: 'bg-amber-100 dark:bg-amber-950', glyph: photoBlock },
  'soft-rounded': { bg: 'bg-pink-50 dark:bg-pink-950', glyph: softBlobs },
  'data-journalism': { bg: 'bg-orange-50 dark:bg-orange-950', glyph: dataBars },
  memphis: { bg: 'bg-yellow-100 dark:bg-yellow-950', glyph: memphisShapes },
}

/* ── 配色色谱：每条 4 swatch + 1 行标签 ── */
export type ColorPaletteKey = 'auto' | 'brand' | JobIndustry

export interface ColorPalette {
  swatches: string[] // Tailwind 色 token 或 #RRGGBB hex；strip 渲染时自动取背景
  label: string
}

export const COLOR_PALETTE: Record<ColorPaletteKey, ColorPalette> = {
  auto: {
    swatches: ['#334155', '#94A3B8', '#0EA5E9', '#F1F5F9'],
    label: 'AI 智能感知主调',
  },
  brand: {
    // brand 模式根据用户输入的 brand_hex 动态派生，这只是占位
    swatches: ['#1A73E8', '#4A90E2', '#8AB4F8', '#E8F0FE'],
    label: '品牌主色',
  },
  finance: { swatches: ['#003366', '#4A6FA5', '#B0C4DE', '#F0F4F8'], label: '海军蓝 · 金融' },
  technology: { swatches: ['#1565C0', '#42A5F5', '#90CAF9', '#E3F2FD'], label: '鲜亮蓝 · 科技' },
  healthcare: { swatches: ['#00796B', '#4DB6AC', '#80CBC4', '#E0F2F1'], label: '青绿 · 医疗' },
  government: { swatches: ['#C41E3A', '#E57373', '#FFCDD2', '#FFF5F5'], label: '中国红 · 政企' },
  education: { swatches: ['#1A237E', '#5C6BC0', '#9FA8DA', '#E8EAF6'], label: '学术深蓝 · 教育' },
  retail: { swatches: ['#E65100', '#FF9800', '#FFCC80', '#FFF3E0'], label: '暖橙 · 零售' },
  creative: { swatches: ['#E91E63', '#FFC107', '#03A9F4', '#8BC34A'], label: '多色 · 创意' },
}

/** 将 brand_hex 派生为 4 色（主 + 副 hue+30° + 浅 L.85 + 深 L.2）。 */
export function brandPalette(hex: string | null | undefined): ColorPalette {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? '').trim())
  if (!m) return COLOR_PALETTE.brand
  const r = parseInt(m[1].slice(0, 2), 16) / 255
  const g = parseInt(m[1].slice(2, 4), 16) / 255
  const b = parseInt(m[1].slice(4, 6), 16) / 255
  // RGB → HSL
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  const hsl = (hh: number, ss: number, ll: number) => `hsl(${(hh * 360).toFixed(1)} ${(ss * 100).toFixed(1)}% ${(ll * 100).toFixed(1)}%)`
  return {
    swatches: [
      hsl(h, s || 0.6, l),                      // 主色
      hsl((h + 30 / 360) % 1, s || 0.6, l),    // 副色 hue+30°
      hsl(h, s || 0.6, 0.85),                  // 浅
      hsl(h, s || 0.6, 0.2),                   // 深
    ],
    label: `品牌主色 #${m[1].toUpperCase()}`,
  }
}
```

- [ ] **Step 4: Verify typecheck + build**

Inside WSL with Node v24:
```bash
wsl bash -lc 'source ~/.nvm/nvm.sh && nvm use v24.11.1 && cd /home/dministrator/ppt-web/webui && npx tsc -b --noEmit && npm run build'
```
Expected: both pass. If `@theme` complains about a custom utility, double-check the swatch Tailwind classes are valid.

- [ ] **Step 5: Commit**

```bash
git add webui/src/lib/aiHints.ts webui/src/lib/jobOptions.ts
git commit -m "$(cat <<'EOF'
feat(webui): composer data — aiHints + style swatches + color palettes

- New aiHints.ts: keyword-triggered hint map + pickHint() (no LLM).
- jobOptions.ts: rename `auto` label to `AI 智能感知`; append
  VISUAL_STYLE_SWATCH (pure-CSS swatch per style) and COLOR_PALETTE
  (4-swatch palettes for auto / brand / 7 industries) + brandPalette()
  helper that derives 4 hues from a hex.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: VisualStyleChips component

**Files:**
- Create: `webui/src/components/jobs/VisualStyleChips.tsx`

**Interfaces:**
- Consumes: `VISUAL_STYLE_SWATCH` from `jobOptions.ts` (Task 1); `JobVisualStyle` type.
- Produces: `<VisualStyleChips value onChange />` — 3-col (sm+) / 2-col (xs) chip grid. The component is purely visual; state lives in `NewJobPage` (Task 4). When `value === 'auto'` and `coreTopic` is non-empty, the `auto` card shows a small "AI 已根据内容自动选择" chip. **NOTE:** per the spec, the component receives `coreTopic: string` as a prop to gate the auto chip — the implementer MUST thread that through.

- [ ] **Step 1: Create the component**

Create `webui/src/components/jobs/VisualStyleChips.tsx`:

```tsx
import { VISUAL_STYLE_OPTIONS, VISUAL_STYLE_SWATCH } from '../../lib/jobOptions'
import type { JobVisualStyle } from '../../lib/jobOptions'

export function VisualStyleChips({
  value,
  onChange,
  coreTopic,
}: {
  value: JobVisualStyle
  onChange: (v: JobVisualStyle) => void
  coreTopic: string
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {VISUAL_STYLE_OPTIONS.map((opt) => {
        const selected = value === opt.value
        const sw = VISUAL_STYLE_SWATCH[opt.value]
        const isAuto = opt.value === 'auto'
        const showAutoChip = isAuto && selected && coreTopic.trim().length > 0
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value as JobVisualStyle)}
            className={`group relative flex flex-col items-stretch overflow-hidden rounded-md border text-left transition-all
                        hover:-translate-y-0.5 hover:shadow-md
                        ${selected
                          ? 'border-gemini-500 ring-1 ring-gemini-500'
                          : 'border-slate-200 dark:border-slate-700'}
                        bg-white/80 dark:bg-slate-900/60`}
          >
            <div className={`flex h-14 items-center justify-center ${sw.bg}`}>
              {sw.glyph}
            </div>
            <div className="px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{opt.label}</span>
                {selected && (
                  <span className="text-[10px] text-gemini-600">✓</span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                {opt.label.includes('·') ? opt.label.split('·')[1].trim() : ''}
              </p>
            </div>
            {showAutoChip && (
              <span className="absolute right-1 top-1 rounded-full bg-gemini-600/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
                AI 已自动选择
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
wsl bash -lc 'source ~/.nvm/nvm.sh && nvm use v24.11.1 && cd /home/dministrator/ppt-web/webui && npx tsc -b --noEmit'
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add webui/src/components/jobs/VisualStyleChips.tsx
git commit -m "$(cat <<'EOF'
feat(webui): VisualStyleChips — pure-CSS swatch grid for visual_style

3-col (sm+) / 2-col chip grid. Each card has a CSS-only swatch from
VISUAL_STYLE_SWATCH (no real thumbnails), label, tagline, and a
checkmark when selected. The auto card shows an "AI 已自动选择"
chip when selected and the user has entered content.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ColorPaletteStrip component

**Files:**
- Create: `webui/src/components/jobs/ColorPaletteStrip.tsx`

**Interfaces:**
- Consumes: `COLOR_PALETTE`, `brandPalette()`, `INDUSTRY_OPTIONS`, `OptionSelect` pattern (or implement locally) from `jobOptions.ts`; `JobColorMode`, `JobIndustry` types.
- Produces: `<ColorPaletteStrip value onChange brandHex onBrandHexChange industry onIndustryChange />` — 3 pill mode buttons + the active palette strip + the brand/industry inline inputs as needed.

- [ ] **Step 1: Create the component**

Create `webui/src/components/jobs/ColorPaletteStrip.tsx`:

```tsx
import {
  COLOR_PALETTE,
  COLOR_MODE_OPTIONS,
  INDUSTRY_OPTIONS,
  brandPalette,
} from '../../lib/jobOptions'
import type { JobColorMode, JobIndustry } from '../../lib/jobOptions'

const COLOR_MODE_LABELS: Record<JobColorMode, string> = {
  auto: 'auto',
  brand: '品牌色',
  industry: '行业预设',
}

const PILL_BTN =
  'rounded-full px-3 py-1 text-xs transition-colors border '

export function ColorPaletteStrip({
  value,
  onChange,
  brandHex,
  onBrandHexChange,
  industry,
  onIndustryChange,
}: {
  value: JobColorMode
  onChange: (v: JobColorMode) => void
  brandHex: string | null
  onBrandHexChange: (v: string | null) => void
  industry: JobIndustry | null
  onIndustryChange: (v: JobIndustry) => void
}) {
  // 决定当前展示的调色板
  let active: { swatches: string[]; label: string }
  if (value === 'brand') active = brandPalette(brandHex)
  else if (value === 'industry') active = COLOR_PALETTE[industry ?? 'technology']
  else active = COLOR_PALETTE.auto

  return (
    <div className="space-y-2">
      {/* pill 模式切换 */}
      <div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
        {COLOR_MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value as JobColorMode)
              // 切换模式时清掉不相关字段
              if (opt.value !== 'brand') onBrandHexChange(null)
              if (opt.value !== 'industry') onIndustryChange(industry as JobIndustry) // noop（仍保留）
            }}
            className={`${PILL_BTN} ${
              value === opt.value
                ? 'border-gemini-500 bg-gemini-600 text-white'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {COLOR_MODE_LABELS[opt.value]}
          </button>
        ))}
      </div>

      {/* 色谱带 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {active.swatches.map((c, i) => (
            <span
              key={i}
              className="inline-block h-5 w-5 rounded-full ring-1 ring-slate-700/30 dark:ring-slate-300/20"
              style={{ background: c }}
              aria-hidden
            />
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">{active.label}</span>
      </div>

      {/* 品牌色输入 */}
      {value === 'brand' && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={brandHex ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim() || null
              onBrandHexChange(v)
            }}
            placeholder="#003366"
            className="w-32 rounded-md border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
          />
          <span className="text-xs text-slate-500">HEX 格式 #RRGGBB</span>
        </div>
      )}

      {/* 行业下拉（原生 select，无 per-row swatch 增强） */}
      {value === 'industry' && (
        <select
          value={industry ?? 'technology'}
          onChange={(e) => onIndustryChange(e.target.value as JobIndustry)}
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          {INDUSTRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck + build**

```bash
wsl bash -lc 'source ~/.nvm/nvm.sh && nvm use v24.11.1 && cd /home/dministrator/ppt-web/webui && npx tsc -b --noEmit && npm run build'
```
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add webui/src/components/jobs/ColorPaletteStrip.tsx
git commit -m "$(cat <<'EOF'
feat(webui): ColorPaletteStrip — mode pills + 4-swatch strip

Replaces the color_mode radio + brand/industry inputs. Three pill mode
buttons (auto / 品牌色 / 行业预设), then a 4-circle swatch strip + label
that reflects the active palette. brand mode derives 4 hues from the
user's hex via brandPalette() and updates live. industry mode uses a
native select (no per-row swatch enhancement per spec §4.1 option B).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: ImageStrategyCards component

**Files:**
- Create: `webui/src/components/jobs/ImageStrategyCards.tsx`

**Interfaces:**
- Consumes: `IMAGE_STRATEGY_OPTIONS` from `jobOptions.ts`; `JobImageStrategy` type.
- Produces: `<ImageStrategyCards value onChange />` — 2-col pill-card grid with 5 options, each with a tiny inline-SVG glyph + label + tagline.

- [ ] **Step 1: Create the component**

Create `webui/src/components/jobs/ImageStrategyCards.tsx`:

```tsx
import { IMAGE_STRATEGY_OPTIONS } from '../../lib/jobOptions'
import type { JobImageStrategy } from '../../lib/jobOptions'

const GLYPHS: Record<JobImageStrategy, JSX.Element> = {
  web: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  provided: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M21 11.5l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
    </svg>
  ),
  placeholder: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="8" opacity="0.5" />
      <rect x="3" y="13" width="8" height="8" opacity="0.5" />
      <rect x="13" y="13" width="8" height="8" />
    </svg>
  ),
  none: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <line x1="5" y1="5" x2="19" y2="19" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
    </svg>
  ),
}

const TAGLINES: Record<JobImageStrategy, string> = {
  web: '默认 / 速度快',
  provided: '仅用您的素材',
  placeholder: '纯色块 / 无图',
  none: '纯文字排版',
  ai: '需配置 key / 可能失败',
}

export function ImageStrategyCards({
  value,
  onChange,
}: {
  value: JobImageStrategy
  onChange: (v: JobImageStrategy) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {IMAGE_STRATEGY_OPTIONS.map((opt) => {
        const selected = value === opt.value
        return (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors
                        ${selected
                          ? 'border-gemini-500 bg-gemini-50 dark:bg-gemini-950'
                          : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'}`}
          >
            <input
              type="radio"
              name="image_strategy"
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value as JobImageStrategy)}
              className="sr-only"
            />
            <span className="text-gemini-600">{GLYPHS[opt.value]}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate">{opt.label}</div>
              <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                {TAGLINES[opt.value]}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
wsl bash -lc 'source ~/.nvm/nvm.sh && nvm use v24.11.1 && cd /home/dministrator/ppt-web/webui && npx tsc -b --noEmit'
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add webui/src/components/jobs/ImageStrategyCards.tsx
git commit -m "$(cat <<'EOF'
feat(webui): ImageStrategyCards — pill-card grid for image_strategy

Replaces the existing radio grid with 2-col cards: inline-SVG glyph +
label + 1-line tagline per option. Same 5 options, no new enum.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rewrite NewJobPage — 3 sections + visual controls + dark canvas

**Files:**
- Modify: `webui/src/pages/NewJobPage.tsx` (full rewrite)

**Interfaces:**
- Consumes: all 4 new files (Tasks 1-4) + existing imports.
- Produces: the restructured page composing `<VisualStyleChips>`, `<ColorPaletteStrip>`, `<ImageStrategyCards>`, `<FileUploadZone>`, and the existing `<OptionSelect>` pattern. 3 collapsible sections (① always open, ② ③ collapsed by default), advanced as a bottom gear.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `webui/src/pages/NewJobPage.tsx` with:

```tsx
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { notifyError, notifySuccess } from '../stores/toastStore'
import { JOBS_KEY } from '../hooks/useJobs'
import { FileUploadZone } from '../components/jobs/FileUploadZone'
import { VisualStyleChips } from '../components/jobs/VisualStyleChips'
import { ColorPaletteStrip } from '../components/jobs/ColorPaletteStrip'
import { ImageStrategyCards } from '../components/jobs/ImageStrategyCards'
import {
  getDefaultModelInfo,
  invalidateDefaultModelCache,
  type ModelInfo,
} from '../components/jobs/AiOptimizeButton'
import {
  AUDIENCE_OPTIONS,
  CANVAS_OPTIONS,
  DEFAULT_JOB_OPTIONS,
  FORMULA_POLICY_OPTIONS,
  ICON_STRATEGY_OPTIONS,
  LANGUAGE_OPTIONS,
  MODE_OPTIONS,
  PAGE_COUNT_MAX,
  PAGE_COUNT_MIN,
  SCENARIO_OPTIONS,
  TONE_OPTIONS,
  type JobOptions,
} from '../lib/jobOptions'
import { pickHint } from '../lib/aiHints'

const SELECT_CLASS =
  'w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800'

function OptionSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  className = '',
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={SELECT_CLASS}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const PAGE_COUNT_OPTIONS = Array.from(
  { length: PAGE_COUNT_MAX - PAGE_COUNT_MIN + 1 },
  (_, i) => {
    const n = PAGE_COUNT_MIN + i
    return { value: String(n), label: `${n} 页` }
  },
)

type CreateMode = 'topic' | 'document'

const PANEL_CLASS =
  'rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/40'

const SECTION_HEADER =
  'flex w-full items-center justify-between text-left text-sm font-medium text-slate-700 dark:text-slate-200'

export function NewJobPage() {
  const quota = useAuthStore((s) => s.quota)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [projectName, setProjectName] = useState('')
  const [options, setOptions] = useState<JobOptions>(DEFAULT_JOB_OPTIONS)
  const [coreTopic, setCoreTopic] = useState('')
  const [outlineText, setOutlineText] = useState('')
  const [keyPointsText, setKeyPointsText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)

  // 内容输入模式 + 分节折叠状态
  const [mode, setMode] = useState<CreateMode>('topic')
  const [openTone, setOpenTone] = useState(false)
  const [openImagery, setOpenImagery] = useState(false)
  const [openAdvanced, setOpenAdvanced] = useState(false)

  const canSubmit = useMemo(
    () =>
      !submitting &&
      !autoFilling &&
      quota() > 0 &&
      coreTopic.trim().length > 0 &&
      (mode === 'topic' || files.length > 0),
    [submitting, autoFilling, quota, coreTopic, mode, files],
  )

  const set = <K extends keyof JobOptions>(key: K, v: JobOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: v }))

  // 智能填充成功后自动展开 ②
  const onAutoFillSuccess = () => setOpenTone(true)

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('prompt', coreTopic.trim())
      if (projectName.trim()) fd.append('project_name', projectName.trim())
      fd.append('language', options.language)
      fd.append('scenario', options.scenario)
      fd.append('audience', options.audience)
      fd.append('tone', options.tone)
      fd.append('page_count', String(options.page_count))
      fd.append('canvas', options.canvas)
      fd.append('mode', options.mode)
      fd.append('visual_style', options.visual_style ?? 'auto')
      fd.append('color_mode', options.color_mode)
      if (options.brand_hex) fd.append('brand_hex', options.brand_hex)
      if (options.industry) fd.append('industry', options.industry)
      fd.append('image_strategy', options.image_strategy)
      if (coreTopic.trim()) fd.append('core_topic', coreTopic.trim())
      if (outlineText.trim()) fd.append('outline', outlineText)
      if (keyPointsText.trim()) fd.append('key_points', keyPointsText)
      fd.append('icon_strategy', options.icon_strategy)
      fd.append('formula_policy', options.formula_policy)
      fd.append('include_speaker_notes', options.include_speaker_notes ? 'true' : 'false')
      fd.append('split_mode', options.split_mode ? 'true' : 'false')
      for (const f of files) fd.append('files', f, f.name)
      const job = await api<{ id: string }>('POST', '/api/jobs', fd)
      notifySuccess('任务已创建，排队中…')
      invalidateDefaultModelCache()
      await qc.invalidateQueries({ queryKey: JOBS_KEY })
      navigate(`/jobs/${job.id}`)
    } catch (e) {
      notifyError('创建失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  // ── 智能填充（autofill 逻辑完全保留；改名为局部函数 + 加 onSuccess 钩子） ──
  const applySuggestedOptions = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const s = raw as Record<string, unknown>
    setOptions((o) => {
      const next = { ...o }
      const pick = <T extends string>(v: unknown, opts: { value: T }[]) =>
        typeof v === 'string' && opts.some((x) => x.value === (v as T)) ? (v as T) : undefined
      const lang = pick(s.language, LANGUAGE_OPTIONS)
      const sc = pick(s.scenario, SCENARIO_OPTIONS)
      const aud = pick(s.audience, AUDIENCE_OPTIONS)
      const tn = pick(s.tone, TONE_OPTIONS)
      if (lang) next.language = lang
      if (sc) next.scenario = sc
      if (aud) next.audience = aud
      if (tn) next.tone = tn
      if (typeof s.page_count === 'number' && s.page_count >= 3 && s.page_count <= 30) {
        next.page_count = s.page_count
      }
      return next
    })
  }

  const applyStyle = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const s = raw as Record<string, unknown>
    setOptions((o) => {
      const next = { ...o }
      if (typeof s.visual_style === 'string' && s.visual_style) {
        next.visual_style = s.visual_style as JobOptions['visual_style']
      }
      if (typeof s.color_mode === 'string') {
        next.color_mode = s.color_mode as JobOptions['color_mode']
      }
      next.brand_hex = typeof s.brand_hex === 'string' && s.brand_hex ? s.brand_hex : null
      if (typeof s.industry === 'string' && s.industry) {
        next.industry = s.industry as JobOptions['industry']
      } else {
        next.industry = null
      }
      if (typeof s.image_strategy === 'string') {
        next.image_strategy = s.image_strategy as JobOptions['image_strategy']
      }
      return next
    })
  }

  const onAutoFill = async () => {
    if (autoFilling) return
    if (mode === 'topic' && !coreTopic.trim()) return
    if (mode === 'document' && files.length === 0) return
    setAutoFilling(true)
    try {
      const m = await getDefaultModelInfo()
      if (!m.configured) {
        notifyError(m.message || '未配置默认模型，请到 管理后台 → 应用设置 配置')
        return
      }
      const fd = new FormData()
      fd.append('mode', mode)
      fd.append('scenario', options.scenario)
      fd.append('audience', options.audience)
      fd.append('tone', options.tone)
      fd.append('language', options.language)
      if (mode === 'topic') {
        fd.append('core_topic', coreTopic.trim())
      } else {
        for (const f of files) fd.append('files', f, f.name)
      }
      const resp = (await api('POST', '/api/app/llm/auto-fill', fd)) as Record<string, unknown>
      if (mode === 'document') {
        const ct = (resp.core_topic as string | undefined)?.trim()
        if (ct) setCoreTopic(ct)
      }
      const kp = resp.key_points
      if (Array.isArray(kp) && kp.length > 0) {
        setKeyPointsText(kp.map((x) => String(x).trim()).filter(Boolean).join('\n'))
      }
      const outline = resp.outline
      if (Array.isArray(outline) && outline.length > 0) {
        setOutlineText(outline.map((x) => String(x).trim()).filter(Boolean).join('\n'))
      }
      applySuggestedOptions(resp.suggested_options)
      applyStyle(resp.style)
      const modelUsed = (resp.model_used as ModelInfo | undefined) ?? m
      notifySuccess(`智能填充完成（${modelUsed.name ?? '模型'}）`)
      onAutoFillSuccess()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const match = msg.match(/\d+:\s*({.*})/s)
      if (match) {
        try {
          const detail = JSON.parse(match[1])
          notifyError(`智能填充失败：${detail.message ?? msg}`)
          return
        } catch {
          /* fall through */
        }
      }
      notifyError(`智能填充失败：${msg}`)
    } finally {
      setAutoFilling(false)
    }
  }

  const canAutoFill =
    !autoFilling && (mode === 'topic' ? coreTopic.trim().length > 0 : files.length > 0)

  // AI 提示气泡：仅当 core_topic 命中关键词时显示
  const hint = pickHint(coreTopic)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 dark:bg-gradient-to-b dark:from-slate-950 dark:to-slate-900">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">创建任务</h1>
        <Link to="/" className="text-sm text-slate-500 hover:text-gemini-600">
          取消
        </Link>
      </div>

      <div className="space-y-4">
        {/* ── ① 内容源（始终展开） ── */}
        <section className={PANEL_CLASS}>
          <button
            type="button"
            disabled
            aria-disabled
            className={SECTION_HEADER + ' cursor-default'}
          >
            <span>① 内容源</span>
          </button>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs text-slate-500">项目名称（可选）</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                placeholder="例：Q1 产品发布"
              />
            </label>

            {/* 模式切换 */}
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
              {(['topic', 'document'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded px-4 py-1.5 text-sm transition ${
                    mode === m
                      ? 'bg-gemini-600 text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  {m === 'topic' ? '主题输入' : '文档输入'}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {mode === 'topic'
                ? '输入一句话主题，AI 据此生成整套方案。'
                : '上传文档作为素材，AI 解析文档后提炼主题并生成整套方案。'}
            </p>

            {mode === 'document' && (
              <FileUploadZone files={files} onChange={setFiles} />
            )}

            <div>
              <span className="text-xs text-slate-500">
                核心主题 <span className="text-rose-500">*</span>
                {mode === 'document' && (
                  <span className="ml-1 text-slate-400">（可点下方智能填充自动提取，也可手动编辑）</span>
                )}
              </span>
              <textarea
                value={coreTopic}
                onChange={(e) => setCoreTopic(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                placeholder="一句话描述这个 PPT 的主题。例：介绍我们的新产品 X，面向企业客户，核心是提升效率。"
              />
            </div>

            {hint && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
            )}

            <button
              type="button"
              onClick={onAutoFill}
              disabled={!canAutoFill}
              className="w-full rounded-md border border-gemini-300 bg-gemini-50 px-3 py-2 text-sm font-medium text-gemini-700 hover:bg-gemini-100 disabled:opacity-50 dark:border-gemini-700 dark:bg-gemini-950 dark:text-gemini-200 dark:hover:bg-gemini-900"
            >
              {autoFilling
                ? '智能填充中…'
                : mode === 'topic'
                  ? '✨ 智能填充（基于主题生成大纲 / 重点 / 设置 / 风格）'
                  : '✨ 智能填充（解析文档，生成主题 / 大纲 / 重点 / 设置 / 风格）'}
            </button>

            <div>
              <span className="text-xs text-slate-500">章节大纲（每行一个标题）</span>
              <textarea
                value={outlineText}
                onChange={(e) => setOutlineText(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
                placeholder={'封面\n第一章 背景与挑战\n第二章 解决方案\n第三章 实施路径\n第四章 预期收益\n总结'}
              />
            </div>

            <div>
              <span className="text-xs text-slate-500">重点强调（每行一个要点）</span>
              <textarea
                value={keyPointsText}
                onChange={(e) => setKeyPointsText(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
                placeholder={'用户增长 40%\nNPS 突破 60\n节省成本 30%'}
              />
            </div>
          </div>
        </section>

        {/* ── ② 视觉调性（默认折叠） ── */}
        <section className={PANEL_CLASS}>
          <button
            type="button"
            onClick={() => setOpenTone((v) => !v)}
            className={SECTION_HEADER}
          >
            <span>② 视觉调性</span>
            <span className="text-slate-400">{openTone ? '▾' : '▸'}</span>
          </button>
          {openTone && (
            <div className="mt-3 space-y-4">
              {/* 5 个基础字段（从 ① 移过来） */}
              <div>
                <span className="text-xs text-slate-500">基础设置</span>
                <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <OptionSelect label="语言" options={LANGUAGE_OPTIONS} value={options.language} onChange={(v) => set('language', v)} className="flex-1 min-w-[6rem]" />
                  <OptionSelect label="场景" options={SCENARIO_OPTIONS} value={options.scenario} onChange={(v) => set('scenario', v)} className="flex-1 min-w-[7rem]" />
                  <OptionSelect label="受众" options={AUDIENCE_OPTIONS} value={options.audience} onChange={(v) => set('audience', v)} className="flex-1 min-w-[7rem]" />
                  <OptionSelect label="语调" options={TONE_OPTIONS} value={options.tone} onChange={(v) => set('tone', v)} className="flex-1 min-w-[6rem]" />
                  <label className="flex w-20 flex-none flex-col gap-0.5">
                    <span className="text-xs text-slate-500">页数</span>
                    <select
                      value={String(options.page_count)}
                      onChange={(e) => set('page_count', parseInt(e.target.value, 10) as JobOptions['page_count'])}
                      className={SELECT_CLASS}
                    >
                      {PAGE_COUNT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* 视觉风格 chip 网格 */}
              <div>
                <span className="text-xs text-slate-500">视觉风格</span>
                <div className="mt-1">
                  <VisualStyleChips
                    value={(options.visual_style ?? 'auto') as JobOptions['visual_style']}
                    onChange={(v) => set('visual_style', v)}
                    coreTopic={coreTopic}
                  />
                </div>
              </div>

              {/* 配色 */}
              <div>
                <span className="text-xs text-slate-500">配色</span>
                <div className="mt-1">
                  <ColorPaletteStrip
                    value={options.color_mode}
                    onChange={(v) => set('color_mode', v)}
                    brandHex={options.brand_hex}
                    onBrandHexChange={(v) => set('brand_hex', v)}
                    industry={options.industry}
                    onIndustryChange={(v) => set('industry', v)}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── ③ 素材策略（默认折叠） ── */}
        <section className={PANEL_CLASS}>
          <button
            type="button"
            onClick={() => setOpenImagery((v) => !v)}
            className={SECTION_HEADER}
          >
            <span>③ 素材策略</span>
            <span className="text-slate-400">{openImagery ? '▾' : '▸'}</span>
          </button>
          {openImagery && (
            <div className="mt-3">
              <span className="text-xs text-slate-500">图片策略</span>
              <div className="mt-1">
                <ImageStrategyCards
                  value={options.image_strategy}
                  onChange={(v) => set('image_strategy', v)}
                />
              </div>
            </div>
          )}
        </section>

        {/* ── 高级（底部齿轮） ── */}
        <div>
          <button
            type="button"
            onClick={() => setOpenAdvanced((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <span>{openAdvanced ? '▾' : '⚙'}</span>
            <span>高级（画布 / 叙事模式 / 图标 / 公式 / 备注）</span>
          </button>
          {openAdvanced && (
            <div className="mt-3 space-y-3 rounded-md bg-slate-50 p-3 dark:bg-slate-900/60">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <OptionSelect label="画布" options={CANVAS_OPTIONS} value={options.canvas} onChange={(v) => set('canvas', v)} />
                <OptionSelect label="叙事模式" options={MODE_OPTIONS} value={options.mode} onChange={(v) => set('mode', v)} />
                <OptionSelect label="图标策略" options={ICON_STRATEGY_OPTIONS} value={options.icon_strategy} onChange={(v) => set('icon_strategy', v)} />
                <OptionSelect label="公式渲染" options={FORMULA_POLICY_OPTIONS} value={options.formula_policy} onChange={(v) => set('formula_policy', v)} />
              </div>
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={options.include_speaker_notes} onChange={(e) => set('include_speaker_notes', e.target.checked)} />
                  <span>生成演讲者备注</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={options.split_mode} onChange={(e) => set('split_mode', e.target.checked)} />
                  <span>长 deck 分阶段模式</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {quota() <= 0 && (
          <p className="text-sm text-rose-600">Credits 不足，无法创建任务</p>
        )}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="w-full rounded-md bg-gemini-600 py-2.5 text-sm font-medium text-white hover:bg-gemini-700 disabled:opacity-50"
        >
          {submitting ? '提交中…' : '创建任务'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck + build + lint**

Inside WSL with Node v24:
```bash
wsl bash -lc 'source ~/.nvm/nvm.sh && nvm use v24.11.1 && cd /home/dministrator/ppt-web/webui && npx tsc -b --noEmit && npm run build && npx eslint src/pages/NewJobPage.tsx; echo "ESLINT-EXIT=$?"'
```
Expected: tsc + build pass; eslint on `NewJobPage.tsx` exits 0 (no errors). If you see a "no-unused-vars" on an import you didn't use, remove it.

- [ ] **Step 3: Commit**

```bash
git add webui/src/pages/NewJobPage.tsx
git commit -m "$(cat <<'EOF'
feat(webui): NewJobPage composer — 3 collapsible sections + visual controls

Restructures the create-job page as 3 collapsible panels (内容源
always open, 视觉调性/素材策略 collapsed by default) with 高级 moved
to a bottom gear. Composes the new VisualStyleChips, ColorPaletteStrip,
and ImageStrategyCards. AI hint bubble below the core_topic textarea
(keyword-triggered, no LLM). Moves 5 basic fields from ① to ② top.
Dark mode deepens with a subtle vertical gradient and frosted panels.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Final verification

**Files:** None (verification only).

- [ ] **Step 1: Full frontend build + lint sweep of touched files**

Inside WSL with Node v24:
```bash
wsl bash -lc 'source ~/.nvm/nvm.sh && nvm use v24.11.1 && cd /home/dministrator/ppt-web/webui && npx tsc -b --noEmit && npm run build && npx eslint src/lib/aiHints.ts src/lib/jobOptions.ts src/components/jobs/VisualStyleChips.tsx src/components/jobs/ColorPaletteStrip.tsx src/components/jobs/ImageStrategyCards.tsx src/pages/NewJobPage.tsx; echo "TOUCHED-ESLINT-EXIT=$?"'
```
Expected: tsc + build pass; eslint on the 6 touched files exits 0 with no errors.

- [ ] **Step 2: Manual smoke**

If the dev webui can run: load `/jobs/new`. Verify
- ① 内容源 is expanded; ② ③ are collapsed; clicking toggles them.
- Type a core_topic containing "商业" — the 💡 hint bubble appears.
- Expand ② → 5 basic fields render in a row; 视觉风格 chip grid shows 12 cards; selecting `auto` + non-empty core_topic shows the "AI 已自动选择" chip on the auto card.
- Click 配色 → pill mode buttons + 4-swatch strip; switch to 品牌色, type `#003366`, see derived swatches; switch to 行业预设, change the dropdown, see palette update.
- Click 高级 (bottom gear) → panel expands; click again → collapses.
- Auto-fill button works (calls /api/app/llm/auto-fill), then auto-expands ②.

If dev servers aren't runnable, skip this step — the build+lint gate covers correctness.

- [ ] **Step 3: Final commit (only if stray fixes were made)**

If Steps 1–2 needed fixes, commit them. Otherwise nothing to commit — done.
