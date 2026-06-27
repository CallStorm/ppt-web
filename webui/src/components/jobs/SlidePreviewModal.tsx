import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadUrl } from '../../api/client'
import { useJobSlideNotes, useJobSlides } from '../../hooks/useJobs'
import { AuthenticatedSlideImage } from './AuthenticatedSlideImage'

interface Props {
  jobId: string
  jobName: string
  onClose: () => void
}

export function SlidePreviewModal({ jobId, jobName, onClose }: Props) {
  const { data, isLoading, error } = useJobSlides(jobId)
  const slides = data?.slides ?? []
  const count = slides.length

  const [current, setCurrent] = useState(0)
  const [showNotes, setShowNotes] = useState(true)

  const slide = slides[current]
  const notesQ = useJobSlideNotes(jobId, slide?.index, !!slide?.has_notes)

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

  // Keyboard navigation: ←/→ to page, Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, onClose])

  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={`预览：${jobName}`}
    >
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{jobName || '预览'}</h2>
          <p className="text-xs text-white/60">
            {count > 0 ? `第 ${current + 1} / ${count} 页` : '加载中…'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadUrl(`/api/jobs/${jobId}/pptx`, `${jobName || jobId}.pptx`)}
          className="rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
        >
          下载 PPTX
        </button>
        <button
          type="button"
          onClick={() => setShowNotes((v) => !v)}
          className="rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
        >
          {showNotes ? '隐藏备注' : '显示备注'}
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

      {/* Body */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-white/70">加载中…</div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-white/70">
          <p>无法加载幻灯片</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            关闭
          </button>
        </div>
      ) : count === 0 ? (
        <div className="flex flex-1 items-center justify-center text-white/70">暂无可预览的幻灯片</div>
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

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 items-center justify-center p-2">
                {slide && (
                  <AuthenticatedSlideImage
                    url={slide.image_url}
                    alt={`第 ${current + 1} 页`}
                    className="max-h-full max-w-full rounded shadow-lg object-contain"
                    loading="eager"
                  />
                )}
              </div>

              {showNotes && slide?.has_notes && (
                <div className="max-h-44 shrink-0 overflow-auto border-t border-white/10 bg-black/40 px-4 py-3">
                  {notesQ.isLoading ? (
                    <p className="text-xs text-white/50">备注加载中…</p>
                  ) : notesQ.error ? (
                    <p className="text-xs text-rose-300">备注加载失败</p>
                  ) : (
                    <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-white/80">
                      {notesQ.data || ''}
                    </div>
                  )}
                </div>
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

          {/* Thumbnail strip */}
          <div className="shrink-0 border-t border-white/10 bg-black/50 px-2 py-2">
            <div className="flex gap-2 overflow-x-auto">
              {slides.map((sl, i) => (
                <button
                  key={sl.index}
                  type="button"
                  onClick={() => jump(i)}
                  className={`relative h-16 w-28 shrink-0 overflow-hidden rounded border bg-white/5 ${
                    i === current
                      ? 'border-gemini-500 ring-1 ring-gemini-500'
                      : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  <AuthenticatedSlideImage
                    url={sl.image_url}
                    alt={`缩略图 ${i + 1}`}
                    className="h-full w-full object-contain"
                  />
                  <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] text-white/80">
                    {i + 1}
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
