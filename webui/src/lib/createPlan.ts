import type { JobOptions } from './jobOptions'
import {
  COLOR_MODE_OPTIONS,
  IMAGE_STRATEGY_OPTIONS,
  INDUSTRY_OPTIONS,
  optionLabel,
  PAGE_COUNT_MAX,
  VISUAL_STYLE_OPTIONS,
} from './jobOptions'

export function parseOutlineLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export function estimateGenerationMinutes(pageCount: number): { min: number; max: number } {
  const base = 4
  const perPage = 1.5
  const min = Math.max(5, Math.round(base + pageCount * perPage * 0.7))
  const max = Math.min(45, Math.round(base + pageCount * perPage * 1.4))
  return { min, max }
}

export function formatVisualSummary(options: JobOptions): string {
  const style =
    VISUAL_STYLE_OPTIONS.find((o) => o.value === (options.visual_style ?? 'auto'))?.label ??
    'AI 智能感知'
  const color =
    options.color_mode === 'brand' && options.brand_hex
      ? `品牌色 ${options.brand_hex}`
      : options.color_mode === 'industry' && options.industry
        ? INDUSTRY_OPTIONS.find((o) => o.value === options.industry)?.label ?? options.industry
        : COLOR_MODE_OPTIONS.find((o) => o.value === options.color_mode)?.label ?? options.color_mode
  const image =
    IMAGE_STRATEGY_OPTIONS.find((o) => o.value === options.image_strategy)?.label ??
    options.image_strategy
  return `${style.split('·')[0].trim()} · ${color} · ${image.split('（')[0].trim()}`
}

export function formatBasicsSummary(options: JobOptions): string {
  return [
    optionLabel(options.language),
    optionLabel(options.scenario),
    optionLabel(options.audience),
    optionLabel(options.tone),
  ].join(' · ')
}

export function outlinePageMismatch(
  outlineLines: number,
  pageCount: number,
): boolean {
  return outlineLines > 0 && outlineLines !== pageCount
}

export function isHeavyDeck(pageCount: number): boolean {
  return pageCount > PAGE_COUNT_MAX / 2
}
