import type { ChatDraft } from '../../../api/types'
import { formatBasicsSummary, formatVisualSummary, estimateGenerationMinutes } from '../../../lib/createPlan'
import type { JobOptions } from '../../../lib/jobOptions'

type Props = {
  draft: ChatDraft
  canGenerate?: boolean
  onGenerate: () => void
  generating?: boolean
}

export function PlanSummaryCard({ draft, canGenerate, onGenerate, generating }: Props) {
  const opts = draft.options as unknown as JobOptions
  const pageCount = Number(opts.page_count || draft.requirements.page_count || 10)
  const { min, max } = estimateGenerationMinutes(pageCount)

  return (
    <div className="mt-3 rounded-xl border-2 border-gemini-200 bg-gemini-50/40 p-4 dark:border-gemini-800 dark:bg-gemini-950/30">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">方案摘要</h3>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500">主题</dt>
          <dd className="font-medium">{draft.core_topic || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">页数 / 基础设置</dt>
          <dd>{pageCount} 页 · {formatBasicsSummary(opts)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">视觉</dt>
          <dd>{formatVisualSummary(opts)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">章节</dt>
          <dd className="text-xs text-slate-600 dark:text-slate-400">
            {(draft.outline ?? []).map((o) => o.title).join(' → ') || '—'}
          </dd>
        </div>
        {draft.template && (
          <div>
            <dt className="text-xs text-slate-500">模板</dt>
            <dd>
              {draft.template.kind}/{draft.template.id}
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        预计 {min}–{max} 分钟 · 确认后将扣除 1 credit 并开始生成
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate || generating}
        className="mt-4 w-full rounded-md bg-gemini-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gemini-700 disabled:opacity-50"
      >
        {generating ? '提交中…' : '开始生成'}
      </button>
    </div>
  )
}
