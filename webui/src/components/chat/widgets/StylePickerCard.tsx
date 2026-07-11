import { useState } from 'react'
import type { ChatDraft } from '../../../api/types'
import { VisualStyleGallery } from '../../jobs/VisualStyleGallery'
import type { JobScenario, JobVisualStyle } from '../../../lib/jobOptions'
import { ImageStrategyCards } from '../../jobs/ImageStrategyCards'

type Props = {
  draft: ChatDraft
  onConfirm: (options: Record<string, unknown>) => void
  submitting?: boolean
}

export function StylePickerCard({ draft, onConfirm, submitting }: Props) {
  const opts = draft.options
  const [visualStyle, setVisualStyle] = useState<JobVisualStyle>(
    (opts.visual_style as JobVisualStyle) || 'auto',
  )
  const [imageStrategy, setImageStrategy] = useState(
    (opts.image_strategy as string) || 'web',
  )

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">视觉风格</h3>
      <p className="mt-1 text-xs text-slate-500">选择整体设计风格与配图策略</p>

      <div className="mt-4">
        <VisualStyleGallery
          value={visualStyle}
          onChange={setVisualStyle}
          coreTopic={draft.core_topic || 'PPT'}
          scenario={(opts.scenario as JobScenario) || 'general'}
        />
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-slate-500">配图策略</p>
        <ImageStrategyCards
          value={imageStrategy as 'web' | 'ai' | 'provided' | 'placeholder' | 'none'}
          onChange={setImageStrategy}
        />
      </div>

      <button
        type="button"
        onClick={() =>
          onConfirm({
            visual_style: visualStyle === 'auto' ? null : visualStyle,
            image_strategy: imageStrategy,
          })
        }
        disabled={submitting}
        className="mt-4 rounded-md bg-gemini-600 px-4 py-2 text-sm font-medium text-white hover:bg-gemini-700 disabled:opacity-50"
      >
        {submitting ? '保存中…' : '确认风格'}
      </button>
    </div>
  )
}
