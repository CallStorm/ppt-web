import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Tab = { id: string; label: string }

type Props = {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  className?: string
  rightSlot?: ReactNode
}

export function Tabs({ tabs, active, onChange, className, rightSlot }: Props) {
  return (
    <div className={cn('flex items-center gap-4 border-b border-border', className)}>
      <div className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              active === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-fg hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {rightSlot}
    </div>
  )
}
