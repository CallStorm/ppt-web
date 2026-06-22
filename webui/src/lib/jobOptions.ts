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
  { value: 'auto', label: 'auto（AI 推荐）' },
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
