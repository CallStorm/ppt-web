import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  isDark: () => boolean
  toggle: () => void
  init: () => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',

  isDark: () => get().theme === 'dark',

  init: () => {
    try {
      const stored = localStorage.getItem('ppt.theme') as Theme | null
      const theme =
        stored === 'dark' || stored === 'light'
          ? stored
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
      applyTheme(theme)
      set({ theme })
    } catch {
      /* ignore */
    }
  },

  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    localStorage.setItem('ppt.theme', next)
    set({ theme: next })
  },
}))
