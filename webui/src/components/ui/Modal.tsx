import { useModalStore } from '../../stores/modalStore'

export function ModalHost() {
  const open = useModalStore((s) => s.open)
  const config = useModalStore((s) => s.config)

  if (!open || !config) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-semibold">{config.title}</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{config.body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={config.onCancel}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {config.cancelText}
          </button>
          <button
            type="button"
            onClick={config.onConfirm}
            className="rounded-md bg-gemini-600 px-4 py-2 text-sm font-medium text-white hover:bg-gemini-700"
          >
            {config.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
