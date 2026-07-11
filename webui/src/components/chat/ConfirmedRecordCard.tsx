import type { ChatDraft, ChatRequirements, OutlineItem } from '../../api/types'
import { SCENARIO_OPTIONS, IMAGE_STRATEGY_OPTIONS, VISUAL_STYLE_OPTIONS } from '../../lib/jobOptions'
import { formatVisualSummary } from '../../lib/createPlan'
import type { JobOptions } from '../../lib/jobOptions'

export type ConfirmAction = 'requirements_submit' | 'outline_confirm' | 'style_confirm'

type Snapshot = {
  requirements?: ChatRequirements
  outline?: OutlineItem[]
  options?: Record<string, unknown>
  template?: { kind: string; id: string } | null
}

type Props = {
  action?: string | null
  snapshot?: Snapshot | null
  /** 旧消息无 snapshot 时，用当前 draft 兜底展示 */
  draft?: ChatDraft | null
  label: string
}

function inferAction(content: string): ConfirmAction | null {
  if (content.includes('需求已确认')) return 'requirements_submit'
  if (content.includes('大纲已确认')) return 'outline_confirm'
  if (content.includes('风格已选定')) return 'style_confirm'
  return null
}

function scenarioLabel(value: string) {
  return SCENARIO_OPTIONS.find((o) => o.value === value)?.label ?? value
}

function RequirementsReadonly({ req }: { req: ChatRequirements }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">内容需求单</h4>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          已确认
        </span>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">计划页数</dt>
          <dd>{req.page_count} 页</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">使用场景</dt>
          <dd>{scenarioLabel(req.scenario)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-500">配图</dt>
          <dd>{req.need_images ? '需要配图（网络搜索）' : '不需要配图'}</dd>
        </div>
      </dl>
      {req.dynamic_answers?.some((a) => a.answer?.trim()) && (
        <ul className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          {req.dynamic_answers
            .filter((a) => a.answer?.trim())
            .map((a, i) => (
              <li key={i} className="text-sm">
                <span className="text-xs text-slate-500">{a.question}</span>
                <p className="mt-0.5 text-slate-800 dark:text-slate-200">{a.answer}</p>
              </li>
            ))}
        </ul>
      )}
      {req.extra_notes?.trim() && (
        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
          <dt className="text-xs text-slate-500">补充说明</dt>
          <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{req.extra_notes}</dd>
        </div>
      )}
    </div>
  )
}

function StyleReadonly({
  options,
  template,
}: {
  options: Record<string, unknown>
  template?: { kind: string; id: string } | null
}) {
  const opts = options as unknown as JobOptions
  const styleId = (options.visual_style as string) || 'auto'
  const styleLabel =
    VISUAL_STYLE_OPTIONS.find((o) => o.value === styleId)?.label ?? 'AI 智能感知'
  const imageLabel =
    IMAGE_STRATEGY_OPTIONS.find((o) => o.value === (options.image_strategy as string))?.label ??
    String(options.image_strategy ?? 'web')

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">视觉风格</h4>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          已确认
        </span>
      </div>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500">风格</dt>
          <dd>{styleLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">配色与配图</dt>
          <dd>{formatVisualSummary(opts)} · {imageLabel.split('（')[0]}</dd>
        </div>
        {template && (
          <div>
            <dt className="text-xs text-slate-500">模板</dt>
            <dd>
              {template.kind}/{template.id}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

export function ConfirmedRecordCard({ action, snapshot, draft, label }: Props) {
  const resolvedAction = (action as ConfirmAction) || inferAction(label)
  if (!resolvedAction) return null

  const snap = snapshot ?? {}
  const fallback = draft

  if (resolvedAction === 'requirements_submit') {
    const req = snap.requirements ?? fallback?.requirements
    if (!req) return null
    return <RequirementsReadonly req={req} />
  }

  if (resolvedAction === 'outline_confirm') {
    const outline = snap.outline ?? fallback?.outline
    if (!outline?.length) return null
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">大纲</h4>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            已确认
          </span>
        </div>
        <ul className="space-y-1.5">
          {outline.map((item, idx) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/50"
            >
              <span className="w-6 text-xs text-slate-400">{idx + 1}</span>
              <span className="flex-1 text-slate-800 dark:text-slate-200">{item.title}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (resolvedAction === 'style_confirm') {
    const options = snap.options ?? fallback?.options
    if (!options) return null
    return (
      <StyleReadonly
        options={options}
        template={snap.template ?? fallback?.template ?? null}
      />
    )
  }

  return null
}
