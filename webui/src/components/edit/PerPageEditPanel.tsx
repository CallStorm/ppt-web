import type { EditTargetSlide, RevisionItem } from '../../api/types'

const MAX_COMMENT = 1000

export function PerPageEditPanel({
  slides,
  comments,
  onCommentChange,
}: {
  slides: EditTargetSlide[]
  comments: Record<number, string>
  onCommentChange: (index: number, value: string) => void
}) {
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {slides.map((sl) => (
        <li
          key={sl.index}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
            <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {sl.index}
            </span>
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
              {sl.name}
            </span>
          </div>
          <div className="bg-slate-100 dark:bg-slate-800/60">
            <img
              src={sl.image_url}
              alt={`第 ${sl.index} 页`}
              className="mx-auto block max-h-72 w-full object-contain"
              loading="lazy"
            />
          </div>
          <div className="p-3">
            <label
              htmlFor={`comment-${sl.index}`}
              className="mb-1 block text-xs text-slate-500 dark:text-slate-400"
            >
              修改意见（可选；不填则不改这页）
            </label>
            <textarea
              id={`comment-${sl.index}`}
              value={comments[sl.index] ?? ''}
              onChange={(e) =>
                onCommentChange(sl.index, e.target.value.slice(0, MAX_COMMENT))
              }
              placeholder="例如：把字号加大 / 换一张更稳重的图 / 删掉这一行"
              rows={3}
              className="w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-gemini-500 focus:outline-none focus:ring-1 focus:ring-gemini-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              maxLength={MAX_COMMENT}
            />
            <div className="mt-1 text-right text-[10px] text-slate-400">
              {(comments[sl.index] ?? '').length} / {MAX_COMMENT}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function collectPerPageItems(
  comments: Record<number, string>,
): RevisionItem[] {
  const out: RevisionItem[] = []
  for (const [k, v] of Object.entries(comments)) {
    const trimmed = (v ?? '').trim()
    if (trimmed) {
      out.push({
        slide_index: Number(k),
        comment: trimmed.slice(0, MAX_COMMENT),
      })
    }
  }
  return out
}
