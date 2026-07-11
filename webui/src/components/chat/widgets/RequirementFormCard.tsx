import { useState } from 'react'
import type { ChatDraft, ChatRequirements } from '../../../api/types'
import { SCENARIO_OPTIONS, PAGE_COUNT_MIN, PAGE_COUNT_MAX } from '../../../lib/jobOptions'

type Props = {
  draft: ChatDraft
  onSubmit: (requirements: ChatRequirements) => void
  submitting?: boolean
}

export function RequirementFormCard({ draft, onSubmit, submitting }: Props) {
  const req = draft.requirements
  const [pageCount, setPageCount] = useState(req.page_count || 10)
  const [scenario, setScenario] = useState(req.scenario || 'general')
  const [needImages, setNeedImages] = useState(req.need_images ?? true)
  const [answers, setAnswers] = useState(
    req.dynamic_answers?.length
      ? req.dynamic_answers
      : [
          { question: '主要听众是谁？', answer: '' },
          { question: '希望突出哪些核心卖点？', answer: '' },
          { question: '有没有必须包含的内容？', answer: '' },
        ],
  )
  const [extraNotes, setExtraNotes] = useState(req.extra_notes || '')

  const handleSubmit = () => {
    onSubmit({
      page_count: pageCount,
      scenario,
      need_images: needImages,
      dynamic_answers: answers,
      extra_notes: extraNotes,
    })
  }

  return (
    <div className="mt-3 rounded-xl border border-gemini-200 bg-white p-4 dark:border-gemini-800 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">内容需求单</h3>
      <p className="mt-1 text-xs text-slate-500">填写后我将为你生成大纲初稿</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-500">计划页数</span>
          <select
            value={pageCount}
            onChange={(e) => setPageCount(Number(e.target.value))}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            {Array.from({ length: PAGE_COUNT_MAX - PAGE_COUNT_MIN + 1 }, (_, i) => {
              const n = PAGE_COUNT_MIN + i
              return (
                <option key={n} value={n}>
                  {n} 页
                </option>
              )
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-500">使用场景</span>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            {SCENARIO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={needImages}
          onChange={(e) => setNeedImages(e.target.checked)}
        />
        需要配图（网络搜索素材）
      </label>

      <div className="mt-4 space-y-3">
        {answers.map((item, idx) => (
          <label key={idx} className="block text-xs">
            <span className="text-slate-500">{item.question}</span>
            <input
              type="text"
              value={item.answer}
              onChange={(e) => {
                const next = [...answers]
                next[idx] = { ...item, answer: e.target.value }
                setAnswers(next)
              }}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
        ))}
      </div>

      <label className="mt-3 block text-xs">
        <span className="text-slate-500">补充说明（可选）</span>
        <textarea
          value={extraNotes}
          onChange={(e) => setExtraNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      </label>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-4 rounded-md bg-gemini-600 px-4 py-2 text-sm font-medium text-white hover:bg-gemini-700 disabled:opacity-50"
      >
        {submitting ? '提交中…' : '确认需求，生成大纲'}
      </button>
    </div>
  )
}
