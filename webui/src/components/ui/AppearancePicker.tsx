import { useEffect, useRef, useState } from 'react'
import { THEMES } from '../../lib/themes'
import { useAppearanceStore, type ThemeId } from '../../stores/appearanceStore'
import { cn } from '../../lib/cn'

function ThemePreviewCard({
  theme,
  active,
  onSelect,
}: {
  theme: (typeof THEMES)[number]
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-2 rounded-[var(--radius-panel)] border p-2.5 text-left transition-colors',
        active
          ? 'border-primary bg-primary-muted/40 ring-1 ring-primary/30'
          : 'border-border bg-surface-elevated hover:border-primary/30',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{theme.label}</span>
        {active && <span className="text-[10px] text-primary">✓</span>}
      </div>
      <p className="text-[10px] leading-snug text-muted-fg">{theme.description}</p>
      <div
        className="h-8 rounded-md border border-border/60"
        style={{ background: theme.preview.sidebar }}
      />
      <div className="flex gap-1">
        <span
          className="h-5 flex-1 rounded-[var(--radius-control)]"
          style={{ background: theme.preview.primary }}
        />
        <span
          className="h-5 w-8 rounded-[var(--radius-control)] border"
          style={{ background: theme.preview.surface, borderColor: theme.preview.accent }}
        />
      </div>
    </button>
  )
}

export function AppearancePicker() {
  const theme = useAppearanceStore((s) => s.theme)
  const setTheme = useAppearanceStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="主题设置"
        onClick={() => setOpen((v) => !v)}
        className="rounded-[var(--radius-control)] px-2 py-1.5 text-sm text-muted-fg transition-colors hover:bg-primary-muted/40 hover:text-foreground"
      >
        主题
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-[var(--radius-panel)] border border-border bg-surface-elevated p-3 shadow-[var(--shadow-panel)]">
          <p className="mb-2 text-xs font-medium text-muted-fg">选择主题风</p>
          <div className="space-y-2">
            {THEMES.map((t) => (
              <ThemePreviewCard
                key={t.id}
                theme={t}
                active={theme === t.id}
                onSelect={() => {
                  setTheme(t.id as ThemeId)
                  setOpen(false)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ThemePickerInline({ className }: { className?: string }) {
  const theme = useAppearanceStore((s) => s.theme)
  const setTheme = useAppearanceStore((s) => s.setTheme)

  return (
    <div className={cn('flex flex-wrap justify-center gap-2', className)}>
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTheme(t.id)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs transition-colors',
            theme === t.id
              ? 'border-primary bg-primary-muted text-primary'
              : 'border-border text-muted-fg hover:border-primary/40',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
