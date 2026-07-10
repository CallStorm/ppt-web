import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TemplateCatalogEntry } from '../../lib/jobOptions'
import {
  templatePreviewSlides,
  templatePreviewUrl,
  templateSlideLabel,
} from '../../lib/templatePreview'

interface Props {
  entry: TemplateCatalogEntry
  onClose: () => void
  onSelect: (entry: TemplateCatalogEntry) => void
}

export function TemplatePreviewModal({ entry, onClose, onSelect }: Props) {
  const slides = templatePreviewSlides(entry)
  const count = slides.length

  const [current, setCurrent] = useState(0)

  const go = useCallback(
    (delta: number) => {
      setCurrent((i) => {
        if (count === 0) return i
        return (i + delta + count) % count
      })
    },
    [count],
  )

  const jump = useCallback((i: number) => setCurrent(i), [])

  useEffect(() => {
    setCurrent(0)
  }, [entry.kind, entry.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const svgName = slides[current]
  const slideLabel = svgName ? templateSlideLabel(svgName) : ''

  const handleSelect = () => {
    onSelect(entry)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={`预览模板：${entry.id}`}
    >
      <div className="flex items-center gap-2 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{entry.id}</h2>
          <p className="truncate text-xs text-white/60">
            {entry.kind} · {entry.summary || '模板预览'}
          </p>
          {count > 0 && (
            <p className="text-xs text-white/50">
              第 {current + 1} / {count} 页 · {slideLabel}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSelect}
          className="rounded-md bg-gemini-600 px-3 py-1.5 text-xs font-medium hover:bg-gemini-700"
        >
          使用此模板
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
          aria-label="关闭"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {count === 0 ? (
        <div className="flex flex-1 items-center justify-center text-white/70">暂无可预览的版式</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-stretch">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={count <= 1}
              className="flex w-12 items-center justify-center text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-20"
              aria-label="上一页"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div className="flex min-w-0 flex-1 items-center justify-center p-4">
              {svgName && (
                <img
                  src={templatePreviewUrl(entry, svgName)}
                  alt={`${entry.id} ${slideLabel}`}
                  className="max-h-full max-w-full rounded shadow-lg object-contain"
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => go(1)}
              disabled={count <= 1}
              className="flex w-12 items-center justify-center text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-20"
              aria-label="下一页"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div className="shrink-0 border-t border-white/10 bg-black/50 px-2 py-2">
            <div className="flex gap-2 overflow-x-auto">
              {slides.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => jump(i)}
                  title={templateSlideLabel(name)}
                  className={`relative h-16 w-28 shrink-0 overflow-hidden rounded border bg-white/5 ${
                    i === current
                      ? 'border-gemini-500 ring-1 ring-gemini-500'
                      : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  <img
                    src={templatePreviewUrl(entry, name)}
                    alt={templateSlideLabel(name)}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 text-[10px] text-white/80">
                    {templateSlideLabel(name)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
