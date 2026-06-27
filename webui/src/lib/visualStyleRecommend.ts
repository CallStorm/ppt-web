import type { JobScenario, JobVisualStyle } from './jobOptions'

/** Client-side hints from ppt-master visual-styles/_index.md §2 auto-selection. */
const SCENARIO_STYLE_HINTS: Partial<Record<JobScenario, JobVisualStyle[]>> = {
  proposal: ['swiss-minimal', 'editorial', 'data-journalism'],
  product: ['soft-rounded', 'glassmorphism', 'dark-tech'],
  training: ['soft-rounded', 'sketch-notes', 'chalkboard', 'editorial'],
  popular_science: ['editorial', 'photo-editorial', 'sketch-notes', 'soft-rounded'],
  speech: ['dark-tech', 'glassmorphism', 'swiss-minimal'],
  project_report: ['data-journalism', 'editorial', 'blueprint'],
  general: ['editorial', 'soft-rounded', 'dark-tech'],
}

const KEYWORD_RULES: { keywords: string[]; styles: JobVisualStyle[] }[] = [
  { keywords: ['金融', '财经', '市场', '研报', '投资', '资本', 'econom', 'finance'], styles: ['data-journalism', 'editorial'] },
  { keywords: ['架构', '工程', 'kubernetes', '系统', '蓝图', 'engineering'], styles: ['blueprint', 'dark-tech'] },
  { keywords: ['ai', '人工智能', '大模型', 'agent', '技术发布', '开发者'], styles: ['dark-tech', 'glassmorphism'] },
  { keywords: ['saas', '产品发布', 'fintech', '应用'], styles: ['glassmorphism', 'soft-rounded'] },
  { keywords: ['培训', '教程', '教学', 'onboarding', '课程', '课堂'], styles: ['sketch-notes', 'chalkboard', 'soft-rounded'] },
  { keywords: ['建筑', '摄影', '时尚', '设计', '人文'], styles: ['photo-editorial', 'editorial'] },
  { keywords: ['年报', 'manifesto', '宣言', '报刊'], styles: ['brutalist', 'data-journalism'] },
  { keywords: ['音乐节', '营销', '创意', '活动', '年轻'], styles: ['memphis', 'soft-rounded'] },
  { keywords: ['咨询', '战略', '极简', 'luxury'], styles: ['swiss-minimal', 'editorial'] },
  { keywords: ['文化', '哲学', 'heritage', '新中式', '东方', '水墨'], styles: ['ink-wash', 'ink-notes', 'editorial'] },
  { keywords: ['民俗', '节庆', '剪纸', '儿童'], styles: ['paper-cut', 'sketch-notes'] },
  { keywords: ['独立', '杂志', 'zine', 'riso'], styles: ['zine', 'vintage-poster'] },
  { keywords: ['老字号', '文旅', '复古', '周年', 'heritage'], styles: ['vintage-poster', 'zine'] },
  { keywords: ['游戏', '像素', '8-bit', 'retro'], styles: ['pixel-art', 'vintage-poster'] },
  { keywords: ['黑板', '粉笔', '讲堂'], styles: ['chalkboard', 'sketch-notes'] },
]

function uniqueStyles(styles: JobVisualStyle[]): JobVisualStyle[] {
  const seen = new Set<JobVisualStyle>()
  const out: JobVisualStyle[] = []
  for (const s of styles) {
    if (s === 'auto' || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** Up to 3 recommended visual styles (excludes auto). */
export function recommendVisualStyles(
  scenario: JobScenario,
  coreTopic: string,
): JobVisualStyle[] {
  const text = coreTopic.trim().toLowerCase()
  const fromScenario = SCENARIO_STYLE_HINTS[scenario] ?? []
  const fromKeywords: JobVisualStyle[] = []

  if (text) {
    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        fromKeywords.push(...rule.styles)
      }
    }
  }

  return uniqueStyles([...fromKeywords, ...fromScenario]).slice(0, 3)
}

export function isRecommendedStyle(
  styleId: JobVisualStyle,
  scenario: JobScenario,
  coreTopic: string,
): boolean {
  if (styleId === 'auto') return false
  return recommendVisualStyles(scenario, coreTopic).includes(styleId)
}

/** Hint text when auto is selected and topic is known. */
export function autoStyleHint(
  scenario: JobScenario,
  coreTopic: string,
): JobVisualStyle[] {
  return recommendVisualStyles(scenario, coreTopic).slice(0, 2)
}
