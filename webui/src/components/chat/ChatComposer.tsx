import { useRef } from 'react'

type Props = {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  files: File[]
  onFilesChange: (files: File[]) => void
  disabled?: boolean
  sending?: boolean
  placeholder?: string
  variant?: 'hero' | 'compact'
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  files,
  onFilesChange,
  disabled,
  sending,
  placeholder = '描述你的主题…',
  variant = 'compact',
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const isHero = variant === 'hero'

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && !sending && (value.trim() || files.length)) onSend()
    }
  }

  return (
    <div className={isHero ? 'w-full max-w-2xl' : 'w-full'}>
      {files.length > 0 && (
        <p className="mb-2 text-xs text-muted-fg">
          附件：{files.map((f) => f.name).join(', ')}
          <button
            type="button"
            className="ml-2 text-danger"
            onClick={() => onFilesChange([])}
          >
            清除
          </button>
        </p>
      )}
      <div
        className={`relative rounded-2xl border border-border bg-surface-elevated shadow-[var(--shadow-panel)] ${
          isHero ? 'min-h-[140px] px-5 py-4' : 'px-3 py-2'
        }`}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={isHero ? 3 : 2}
          placeholder={placeholder}
          className={`w-full resize-none border-0 bg-transparent text-foreground placeholder:text-muted-fg focus:outline-none focus:ring-0 ${
            isHero ? 'text-base' : 'text-sm'
          }`}
        />
        <div className={`flex items-center justify-between ${isHero ? 'mt-2' : 'mt-1'}`}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            className="rounded-[var(--radius-control)] p-2 text-muted-fg transition hover:bg-primary-muted/40 hover:text-foreground"
            aria-label="添加附件"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => onFilesChange(Array.from(e.target.files ?? []))}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || sending || (!value.trim() && files.length === 0)}
            className={`flex items-center justify-center rounded-full bg-primary text-primary-fg transition hover:bg-primary-hover disabled:opacity-40 ${
              isHero ? 'h-10 w-10' : 'h-9 w-9'
            }`}
            aria-label="发送"
          >
            {sending ? (
              <span className="text-xs">…</span>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export function chatGreeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '上午好'
  if (h < 18) return '下午好'
  return '晚上好'
}
