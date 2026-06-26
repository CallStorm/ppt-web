import { Link } from 'react-router-dom'

export type EditMode = 'per_page' | 'global'

export function EditModeTabs({
  mode,
  onChange,
}: {
  mode: EditMode
  onChange: (m: EditMode) => void
}) {
  return (
    <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={() => onChange('per_page')}
        className={`px-4 py-2 text-sm font-medium transition ${
          mode === 'per_page'
            ? 'border-b-2 border-gemini-500 text-gemini-600 dark:text-gemini-400'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        逐页修改
      </button>
      <button
        type="button"
        onClick={() => onChange('global')}
        className={`px-4 py-2 text-sm font-medium transition ${
          mode === 'global'
            ? 'border-b-2 border-gemini-500 text-gemini-600 dark:text-gemini-400'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        全局修改
      </button>
    </div>
  )
}

export function EditPageHeader({
  jobId,
}: {
  jobId: string
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          编辑已完成的 PPT
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          逐页修改或全局调整视觉/内容。不满意可再次提交；每轮扣 1 积分。
        </p>
      </div>
      <Link
        to={`/jobs/${jobId}`}
        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        返回任务详情
      </Link>
    </header>
  )
}
