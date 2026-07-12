import type { TemplateKind } from './jobOptions'

export const SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
export const KEYWORD_PATTERN = /^[a-z][a-z0-9_-]*$/
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

export const REPLICATION_MODES = ['standard', 'fidelity', 'mirror'] as const
export const NATIVE_STRUCTURE_MODES = ['preserve', 'template'] as const
export const VISUAL_FIDELITIES = ['literal', 'adapted'] as const
export const THEME_MODES = ['light', 'dark'] as const

export type BriefFormFields = {
  slug: string
  display_name: string
  kind: TemplateKind
  scope?: 'global'
  category_id?: string
  replication_mode: string
  native_structure_mode: string
  visual_fidelity: string
  theme_mode: string
  summary: string
  keywords: string[]
  primary_color: string | null
}

export type BriefFieldErrors = Partial<Record<keyof BriefFormFields, string>>

export function normalizeSlugInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

export function validateBriefFields(
  brief: BriefFormFields,
  options: { isAdmin: boolean },
): BriefFieldErrors {
  const errors: BriefFieldErrors = {}

  const displayName = brief.display_name.trim()
  if (!displayName) {
    errors.display_name = '显示名称不能为空'
  } else if (displayName.length > 128) {
    errors.display_name = '不能超过 128 个字符'
  }

  const slug = brief.slug.trim()
  if (!slug) {
    errors.slug = 'Slug 不能为空'
  } else if (!SLUG_PATTERN.test(slug)) {
    errors.slug = '仅允许小写英文字母、数字、下划线和连字符，且须以字母开头'
  }

  if (!['deck', 'layout'].includes(brief.kind)) {
    errors.kind = '无效模板类型'
  }

  if (!REPLICATION_MODES.includes(brief.replication_mode as (typeof REPLICATION_MODES)[number])) {
    errors.replication_mode = '请选择有效的复刻模式'
  }

  if (
    !NATIVE_STRUCTURE_MODES.includes(
      brief.native_structure_mode as (typeof NATIVE_STRUCTURE_MODES)[number],
    )
  ) {
    errors.native_structure_mode = '请选择有效的原生结构策略'
  } else if (
    brief.replication_mode === 'mirror' &&
    brief.native_structure_mode === 'preserve'
  ) {
    errors.native_structure_mode = 'mirror 模式须使用 template（重建）'
  }

  if (!VISUAL_FIDELITIES.includes(brief.visual_fidelity as (typeof VISUAL_FIDELITIES)[number])) {
    errors.visual_fidelity = '请选择有效的视觉保真策略'
  }

  if (!THEME_MODES.includes(brief.theme_mode as (typeof THEME_MODES)[number])) {
    errors.theme_mode = '请选择有效的主题模式'
  }

  if (brief.scope === 'global' && options.isAdmin && !brief.category_id?.trim()) {
    errors.category_id = '发布全局模板时须选择分类'
  }

  if (brief.keywords.length === 0) {
    errors.keywords = '至少填写一个关键词'
  } else {
    const invalid = brief.keywords.find((kw) => !KEYWORD_PATTERN.test(kw.trim()))
    if (invalid) {
      errors.keywords = `关键词「${invalid}」仅允许小写英文、数字、下划线和连字符`
    }
  }

  if (brief.primary_color && !HEX_COLOR_PATTERN.test(brief.primary_color)) {
    errors.primary_color = '主色须为 #RRGGBB 格式（如 #C8152D）'
  }

  if (brief.summary.length > 500) {
    errors.summary = '描述不能超过 500 个字符'
  }

  return errors
}

export function hasBriefErrors(errors: BriefFieldErrors): boolean {
  return Object.keys(errors).length > 0
}
