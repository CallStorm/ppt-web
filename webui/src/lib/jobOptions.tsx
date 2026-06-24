export type JobLanguage = 'zh' | 'en' | 'bilingual'
export type JobScenario =
  | 'general'
  | 'proposal'
  | 'product'
  | 'training'
  | 'popular_science'
  | 'speech'
  | 'project_report'
export type JobAudience =
  | 'general'
  | 'executive'
  | 'team'
  | 'client'
  | 'expert'
  | 'student'
export type JobTone = 'professional' | 'friendly' | 'technical' | 'academic' | 'concise'

// ── 新增 ──
export type JobCanvas = 'ppt169' | 'ppt43' | 'xhs' | 'story' | 'poster'
export type JobMode = 'briefing' | 'pyramid' | 'narrative' | 'instructional' | 'showcase'
export type JobColorMode = 'auto' | 'brand' | 'industry'
export type JobImageStrategy = 'ai' | 'web' | 'provided' | 'placeholder' | 'none'
export type JobIconStrategy = 'emoji' | 'library' | 'ai' | 'custom'
export type JobFormulaPolicy = 'mixed' | 'render-all' | 'text-only'

export type JobVisualStyle =
  | 'auto'
  | 'swiss-minimal'
  | 'glassmorphism'
  | 'dark-tech'
  | 'brutalist'
  | 'editorial'
  | 'blueprint'
  | 'photo-editorial'
  | 'soft-rounded'
  | 'data-journalism'
  | 'memphis'

export type JobIndustry =
  | 'finance'
  | 'technology'
  | 'healthcare'
  | 'government'
  | 'education'
  | 'retail'
  | 'creative'

export interface JobOptions {
  language: JobLanguage
  scenario: JobScenario
  audience: JobAudience
  tone: JobTone
  page_count: number

  // 新增 Tier-1
  canvas: JobCanvas
  mode: JobMode
  visual_style: JobVisualStyle | null
  color_mode: JobColorMode
  brand_hex: string | null
  industry: JobIndustry | null
  image_strategy: JobImageStrategy
  core_topic: string | null
  outline: string[] | null
  key_points: string[] | null

  // 高级
  icon_strategy: JobIconStrategy
  formula_policy: JobFormulaPolicy
  include_speaker_notes: boolean
  split_mode: boolean
}

export interface OptionItem<T extends string = string> {
  value: T
  label: string
}

export const LANGUAGE_OPTIONS: OptionItem<JobLanguage>[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'bilingual', label: '中英双语' },
]

export const SCENARIO_OPTIONS: OptionItem<JobScenario>[] = [
  { value: 'general', label: '通用' },
  { value: 'proposal', label: '方案汇报' },
  { value: 'product', label: '产品介绍' },
  { value: 'training', label: '培训教程' },
  { value: 'popular_science', label: '科普宣传' },
  { value: 'speech', label: '演讲答辩' },
  { value: 'project_report', label: '项目汇报' },
]

export const AUDIENCE_OPTIONS: OptionItem<JobAudience>[] = [
  { value: 'general', label: '通用受众' },
  { value: 'executive', label: '管理层' },
  { value: 'team', label: '团队内部' },
  { value: 'client', label: '客户/合作方' },
  { value: 'expert', label: '评审专家' },
  { value: 'student', label: '学员/学生' },
]

export const TONE_OPTIONS: OptionItem<JobTone>[] = [
  { value: 'professional', label: '专业严谨' },
  { value: 'friendly', label: '轻松友好' },
  { value: 'technical', label: '技术深入' },
  { value: 'academic', label: '学术规范' },
  { value: 'concise', label: '简洁凝练' },
]

export const CANVAS_OPTIONS: OptionItem<JobCanvas>[] = [
  { value: 'ppt169', label: '16:9 演示（默认）' },
  { value: 'ppt43', label: '4:3 演示' },
  { value: 'xhs', label: '小红书 3:4' },
  { value: 'story', label: 'Story 9:16' },
  { value: 'poster', label: '海报/单页' },
]

export const MODE_OPTIONS: OptionItem<JobMode>[] = [
  { value: 'briefing', label: '简报（按内容自然组织）' },
  { value: 'pyramid', label: '金字塔（结论先行）' },
  { value: 'narrative', label: '叙事（故事线）' },
  { value: 'instructional', label: '教学（循序渐进）' },
  { value: 'showcase', label: '展示（视觉主导）' },
]

export const VISUAL_STYLE_OPTIONS: OptionItem<JobVisualStyle>[] = [
  { value: 'auto', label: 'AI 智能感知' },
  { value: 'swiss-minimal', label: '瑞士极简 · 企业内训首选' },
  { value: 'glassmorphism', label: '玻璃拟态 · 现代科技' },
  { value: 'dark-tech', label: '深色科技 · 技术发布' },
  { value: 'brutalist', label: '粗野主义 · 重磅发布' },
  { value: 'editorial', label: '编辑设计 · 内容型' },
  { value: 'blueprint', label: '蓝图 · 工程方案' },
  { value: 'photo-editorial', label: '图册编辑 · 大图主导' },
  { value: 'soft-rounded', label: '柔圆亲和 · ToC/教育' },
  { value: 'data-journalism', label: '数据新闻 · 图表密集' },
  { value: 'memphis', label: '孟菲斯 · 创意营销' },
]

export const COLOR_MODE_OPTIONS: OptionItem<JobColorMode>[] = [
  { value: 'auto', label: 'auto（自动选色）' },
  { value: 'brand', label: '品牌色（指定主色）' },
  { value: 'industry', label: '行业预设' },
]

export const INDUSTRY_OPTIONS: OptionItem<JobIndustry>[] = [
  { value: 'finance', label: '金融 · 海军蓝 #003366' },
  { value: 'technology', label: '科技 · 鲜亮蓝 #1565C0' },
  { value: 'healthcare', label: '医疗 · 青绿 #00796B' },
  { value: 'government', label: '政企 · 中国红 #C41E3A' },
  { value: 'education', label: '教育 · 学术深蓝' },
  { value: 'retail', label: '零售 · 暖橙' },
  { value: 'creative', label: '创意 · 多色' },
]

export const IMAGE_STRATEGY_OPTIONS: OptionItem<JobImageStrategy>[] = [
  { value: 'web', label: '网络搜图（默认，速度快）' },
  { value: 'provided', label: '仅使用上传的图片' },
  { value: 'placeholder', label: '占位符/纯色块' },
  { value: 'none', label: '不使用图片' },
  { value: 'ai', label: 'AI 生图（需配置 key，可能失败）' },
]

export const ICON_STRATEGY_OPTIONS: OptionItem<JobIconStrategy>[] = [
  { value: 'library', label: '内置图标库（默认）' },
  { value: 'emoji', label: 'Emoji（休闲）' },
  { value: 'ai', label: 'AI 生成' },
  { value: 'custom', label: '自定义' },
]

export const FORMULA_POLICY_OPTIONS: OptionItem<JobFormulaPolicy>[] = [
  { value: 'mixed', label: '混合（复杂渲染，简单留文本）' },
  { value: 'render-all', label: '全部渲染为图' },
  { value: 'text-only', label: '全部留文本' },
]

export const DEFAULT_JOB_OPTIONS: JobOptions = {
  language: 'zh',
  scenario: 'general',
  audience: 'general',
  tone: 'professional',
  page_count: 5,

  canvas: 'ppt169',
  mode: 'briefing',
  visual_style: 'auto',
  color_mode: 'auto',
  brand_hex: null,
  industry: null,
  image_strategy: 'web',
  core_topic: null,
  outline: null,
  key_points: null,

  icon_strategy: 'library',
  formula_policy: 'mixed',
  include_speaker_notes: true,
  split_mode: false,
}

export const PAGE_COUNT_MIN = 3
export const PAGE_COUNT_MAX = 30

const ALL_OPTIONS = [
  ...LANGUAGE_OPTIONS,
  ...SCENARIO_OPTIONS,
  ...AUDIENCE_OPTIONS,
  ...TONE_OPTIONS,
  ...CANVAS_OPTIONS,
  ...MODE_OPTIONS,
  ...VISUAL_STYLE_OPTIONS,
  ...COLOR_MODE_OPTIONS,
  ...INDUSTRY_OPTIONS,
  ...IMAGE_STRATEGY_OPTIONS,
  ...ICON_STRATEGY_OPTIONS,
  ...FORMULA_POLICY_OPTIONS,
]

export function optionLabel(value: string): string {
  return ALL_OPTIONS.find((o) => o.value === value)?.label ?? value
}

export function formatJobOptionsSummary(options: JobOptions): string {
  return [
    optionLabel(options.language),
    optionLabel(options.scenario),
    optionLabel(options.audience),
    optionLabel(options.tone),
    `${options.page_count} 页`,
  ].join(' · ')
}

// ── 后端 → 前端清洗：把后端额外字段（不在 schema 的）剥掉，避免循环发送 ──
export function sanitizeJobOptions(o: Partial<JobOptions>): JobOptions {
  return { ...DEFAULT_JOB_OPTIONS, ...o }
}

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
