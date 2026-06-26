import type { EditMode } from './EditModeTabs'

export function EditSubmitFooter({
  mode,
  slideCount,
  filledCount,
  confirmed,
  onConfirmedChange,
  canSubmit,
  submitting,
  onSubmit,
}: {
  mode: EditMode
  slideCount: number
  filledCount: number
  confirmed: boolean
  onConfirmedChange: (v: boolean) => void
  canSubmit: boolean
  submitting: boolean
  onSubmit: () => void
}) {
  const confirmLabel =
    mode === 'global'
      ? `我已了解将影响全部 ${slideCount} 页，提交后将扣 1 个积分`
      : `我已检查全部 ${slideCount} 张图，提交后将扣 1 个积分`

  const submitLabel =
    mode === 'global'
      ? submitting
        ? '提交中…'
        : '提交全局修改'
      : submitting
        ? '提交中…'
        : '提交修改'

  const countLabel =
    mode === 'global'
      ? `已配置全局修改`
      : `已填意见：${filledCount} / ${slideCount}`

  return (
    <footer className="sticky bottom-0 -mx-6 mt-2 border-t border-slate-200 bg-white/90 px-6 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => onConfirmedChange(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-gemini-500 focus:ring-gemini-500"
          />
          {confirmLabel}
        </label>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>
            {mode === 'per_page' ? (
              <>
                已填意见：
                <b className="text-slate-700 dark:text-slate-200">{filledCount}</b> /{' '}
                {slideCount}
              </>
            ) : (
              <span className={filledCount > 0 ? 'text-gemini-600' : ''}>
                {filledCount > 0 ? countLabel : '请完成表单'}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-gemini-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gemini-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </footer>
  )
}
