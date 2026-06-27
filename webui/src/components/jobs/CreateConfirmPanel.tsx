import { forwardRef } from 'react'
import type { JobOptions } from '../../lib/jobOptions'
import {
  estimateGenerationMinutes,
  formatBasicsSummary,
  formatVisualSummary,
  isHeavyDeck,
  outlinePageMismatch,
  parseOutlineLines,
} from '../../lib/createPlan'
import { PAGE_COUNT_MAX, PAGE_COUNT_MIN } from '../../lib/jobOptions'
import { VisualStyleSummaryThumb } from './VisualStyleGallery'

const SELECT_CLASS =
  'rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800'

const PAGE_COUNT_OPTIONS = Array.from(
  { length: PAGE_COUNT_MAX - PAGE_COUNT_MIN + 1 },
  (_, i) => PAGE_COUNT_MIN + i,
)

type Props = {
  id?: string
  pageCount: JobOptions['page_count']
  onPageCountChange: (n: JobOptions['page_count']) => void
  outlineText: string
  onOutlineChange: (v: string) => void
  options: JobOptions
  confirmed: boolean
  onConfirmedChange: (v: boolean) => void
  onExpandTone: () => void
  onExpandImagery: () => void
  submitting: boolean
  canStart: boolean
  onStart: () => void
}

export const CreateConfirmPanel = forwardRef<HTMLElement, Props>(function CreateConfirmPanel(
  {
    id,
    pageCount,
    onPageCountChange,
    outlineText,
    onOutlineChange,
    options,
    confirmed,
    onConfirmedChange,
    onExpandTone,
    onExpandImagery,
    submitting,
    canStart,
    onStart,
  },
  ref,
) {
  const outlineLines = parseOutlineLines(outlineText)
  const mismatch = outlinePageMismatch(outlineLines.length, pageCount)
  const { min, max } = estimateGenerationMinutes(pageCount)
  const heavy = isHeavyDeck(pageCount)
  const outlineEmpty = outlineLines.length === 0

  return (
    <section
      ref={ref}
      id={id}
      className="rounded-xl border-2 border-gemini-200 bg-gemini-50/40 p-4 shadow-sm dark:border-gemini-800 dark:bg-gemini-950/30"
    >
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        ④ 确认方案
      </h2>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        请在此检查页数、大纲与风格。点击「开始生成」后将自动跑完全流程，<strong>中途无法暂停或修改设置</strong>；如需调整请在本页改好再提交。
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-slate-500">计划页数</span>
          <select
            value={String(pageCount)}
            onChange={(e) =>
              onPageCountChange(parseInt(e.target.value, 10) as JobOptions['page_count'])
            }
            className={SELECT_CLASS}
          >
            {PAGE_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} 页</option>
            ))}
          </select>
        </label>
        {outlineLines.length > 0 && (
          <span className="text-xs text-slate-500">
            大纲 {outlineLines.length} 行
            {mismatch && (
              <span className="ml-1 text-amber-700 dark:text-amber-300">
                （与页数不一致）
              </span>
            )}
          </span>
        )}
      </div>

      {mismatch && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          大纲共 {outlineLines.length} 行，但计划页数为 {pageCount}。建议调整页数或增删大纲行，避免结构混乱。
        </p>
      )}

      {heavy && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          页数较多（{pageCount} 页），生成时间会更长，请确认大纲是否合理。
        </p>
      )}

      <div className="mt-3">
        <label className="text-xs text-slate-500">
          章节大纲（每行一页标题，提交前请核对）
        </label>
        <textarea
          value={outlineText}
          onChange={(e) => onOutlineChange(e.target.value)}
          rows={6}
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
          placeholder={'封面\n第一章 背景与挑战\n第二章 解决方案\n…'}
        />
        {outlineEmpty && (
          <p className="mt-1 text-xs text-slate-500">
            尚未填写大纲。可先点「生成方案预览」，或手动填写每页标题。
          </p>
        )}
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <dt className="text-slate-400">基础</dt>
          <dd className="text-slate-700 dark:text-slate-300">{formatBasicsSummary(options)}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <dt className="text-slate-400">视觉与配图</dt>
          <dd className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
            <VisualStyleSummaryThumb styleId={options.visual_style ?? 'auto'} />
            <span>{formatVisualSummary(options)}</span>
          </dd>
          <button
            type="button"
            onClick={onExpandTone}
            className="text-gemini-600 hover:underline dark:text-gemini-400"
          >
            改视觉
          </button>
          <button
            type="button"
            onClick={onExpandImagery}
            className="text-gemini-600 hover:underline dark:text-gemini-400"
          >
            改配图
          </button>
        </div>
      </dl>

      <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
        预计约 <strong>{pageCount}</strong> 页 · 通常需要 <strong>{min}–{max} 分钟</strong>
        （视配图与复杂度而定）· 提交扣 <strong>1</strong> 积分，失败自动退还。
      </p>

      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-gemini-600 focus:ring-gemini-500"
        />
        <span>
          我已确认页数、大纲与风格设置无误；开始后将自动生成且<strong>无法中途修改</strong>。
        </span>
      </label>

      <button
        type="button"
        disabled={!canStart}
        onClick={onStart}
        className="mt-4 w-full rounded-md bg-gemini-600 py-2.5 text-sm font-medium text-white hover:bg-gemini-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? '正在创建…' : '开始生成'}
      </button>
    </section>
  )
})
