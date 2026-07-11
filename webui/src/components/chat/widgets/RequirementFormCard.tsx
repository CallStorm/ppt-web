import { useState } from 'react'
import type { ChatDraft, ChatRequirements } from '../../../api/types'
import { SCENARIO_OPTIONS, PAGE_COUNT_MIN, PAGE_COUNT_MAX } from '../../../lib/jobOptions'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'

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
    <div className="mt-3 rounded-[var(--radius-panel)] border border-primary/20 bg-surface-elevated p-4">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">内容需求单</h3>
      <p className="mt-1 text-xs text-muted-fg">填写后我将为你生成大纲初稿</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-fg">计划页数</span>
          <Select value={pageCount} onChange={(e) => setPageCount(Number(e.target.value))}>
            {Array.from({ length: PAGE_COUNT_MAX - PAGE_COUNT_MIN + 1 }, (_, i) => {
              const n = PAGE_COUNT_MIN + i
              return (
                <option key={n} value={n}>
                  {n} 页
                </option>
              )
            })}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-fg">使用场景</span>
          <Select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={needImages}
          onChange={(e) => setNeedImages(e.target.checked)}
          className="rounded border-border text-primary focus:ring-primary"
        />
        需要配图（网络搜索素材）
      </label>

      <div className="mt-4 space-y-3">
        {answers.map((item, idx) => (
          <label key={idx} className="block text-xs">
            <span className="text-muted-fg">{item.question}</span>
            <Input
              type="text"
              value={item.answer}
              onChange={(e) => {
                const next = [...answers]
                next[idx] = { ...item, answer: e.target.value }
                setAnswers(next)
              }}
              className="mt-1"
            />
          </label>
        ))}
      </div>

      <label className="mt-3 block text-xs">
        <span className="text-muted-fg">补充说明（可选）</span>
        <Textarea
          value={extraNotes}
          onChange={(e) => setExtraNotes(e.target.value)}
          rows={2}
          className="mt-1"
        />
      </label>

      <Button type="button" onClick={handleSubmit} disabled={submitting} className="mt-4">
        {submitting ? '提交中…' : '确认需求，生成大纲'}
      </Button>
    </div>
  )
}
