import { useEffect, useState } from 'react'
import type { JobVisualStyle } from '../../lib/jobOptions'
import {
  catalogEntryFor,
  exampleProjectOnlineUrl,
  type PreviewSlideKind,
  visualStylePreviewUrl,
} from '../../lib/visualStyleCatalog'
import { StylePreviewImage } from './StylePreviewImage'

type Props = {
  styleId: JobVisualStyle
  onClose: () => void
}

const SLIDE_TABS: { kind: PreviewSlideKind; label: string }[] = [
  { kind: 'cover', label: '封面示例' },
  { kind: 'content', label: '内容页示例' },
  { kind: 'closing', label: '结尾示例' },
]

export function StyleDetailSheet({ styleId, onClose }: Props) {
  const entry = catalogEntryFor(styleId)
  const [slideKind, setSlideKind] = useState<PreviewSlideKind>('cover')
  const onlineUrl = exampleProjectOnlineUrl(entry.exampleProjectId)

  useEffect(() => {
    setSlideKind('cover')
  }, [styleId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {entry.title}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {entry.tagline}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            关闭
          </button>
        </div>

        <div className="p-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-700">
            {styleId === 'auto' ? (
              <StylePreviewImage
                styleId="auto"
                className="aspect-video w-full object-cover"
                alt={entry.title}
              />
            ) : (
              <img
                src={visualStylePreviewUrl(styleId, slideKind)}
                alt={`${entry.title} ${slideKind}`}
                className="aspect-video w-full object-cover"
              />
            )}
          </div>

          {styleId !== 'auto' && entry.previewSlides && (
            <div className="mt-2 flex flex-wrap gap-2">
              {SLIDE_TABS.map((tab) => (
                <button
                  key={tab.kind}
                  type="button"
                  onClick={() => setSlideKind(tab.kind)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    slideKind === tab.kind
                      ? 'bg-gemini-600 text-white'
                      : 'border border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            {entry.character}
          </p>

          {entry.colorHint && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              典型配色倾向：{entry.colorHint}
            </p>
          )}

          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              这种风格适合
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              {entry.bestFor.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              不太适合：{entry.notFor}
            </p>
          </div>

          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              视觉特征
            </h4>
            <dl className="mt-2 space-y-1 text-sm">
              {entry.traits.map((t) => (
                <div key={t.label} className="flex gap-2">
                  <dt className="shrink-0 text-slate-400">{t.label}</dt>
                  <dd className="text-slate-700 dark:text-slate-300">{t.text}</dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            演示图来自 ppt-master 官方范例幻灯片，展示该风格的典型版式与气质。
            实际成片配色由你选择的「配色模式」决定（行业预设 / 品牌色 / auto），
            视觉风格本身不锁定 HEX 色值。选定风格后可在创建页调整配色。
          </p>

          {onlineUrl && (
            <a
              href={onlineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-xs text-gemini-600 hover:underline dark:text-gemini-400"
            >
              在 ppt-master 范例站查看完整案例 →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
