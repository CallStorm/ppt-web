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

export interface JobOptions {
  language: JobLanguage
  scenario: JobScenario
  audience: JobAudience
  tone: JobTone
  page_count: number
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

export const DEFAULT_JOB_OPTIONS: JobOptions = {
  language: 'zh',
  scenario: 'general',
  audience: 'general',
  tone: 'professional',
  page_count: 5,
}

export const PAGE_COUNT_MIN = 3
export const PAGE_COUNT_MAX = 30

const ALL_OPTIONS = [
  ...LANGUAGE_OPTIONS,
  ...SCENARIO_OPTIONS,
  ...AUDIENCE_OPTIONS,
  ...TONE_OPTIONS,
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
