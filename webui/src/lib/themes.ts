export type ThemeId = 'modern' | 'forest' | 'guofeng'

export type ThemeMeta = {
  id: ThemeId
  label: string
  description: string
  preview: {
    primary: string
    surface: string
    accent: string
    sidebar: string
  }
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'modern',
    label: '现代科技',
    description: '清爽 SaaS 风格，蓝白卡片',
    preview: {
      primary: '#1a73e8',
      surface: '#f8fafc',
      accent: '#7c3aed',
      sidebar: '#f1f5f9',
    },
  },
  {
    id: 'forest',
    label: '森林',
    description: '墨绿自然风，胶囊按钮与浅绿侧栏',
    preview: {
      primary: '#2d6a4f',
      surface: '#f0f7f4',
      accent: '#52b788',
      sidebar: '#e8f5e9',
    },
  },
  {
    id: 'guofeng',
    label: '古风',
    description: '宣纸水墨，朱红点缀与细金线',
    preview: {
      primary: '#b5423a',
      surface: '#f7f3e9',
      accent: '#c4a574',
      sidebar: '#f3ead8',
    },
  },
]

const LEGACY_SKIN_MAP: Record<string, ThemeId> = {
  default: 'modern',
  warm: 'modern',
  minimal: 'modern',
  fresh: 'forest',
  violet: 'modern',
  business: 'modern',
}

export function normalizeThemeId(raw: string | null): ThemeId {
  if (raw === 'modern' || raw === 'forest' || raw === 'guofeng') return raw
  if (raw && LEGACY_SKIN_MAP[raw]) return LEGACY_SKIN_MAP[raw]
  return 'modern'
}
