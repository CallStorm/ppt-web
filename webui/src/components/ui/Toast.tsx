import { useToastStore } from '../../stores/toastStore'

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (!toasts.length) return null

  const kindClass = {
    info: 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
    success: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
    error: 'border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950',
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex max-w-sm items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${kindClass[t.kind]}`}
        >
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="text-slate-400 hover:text-slate-600"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
