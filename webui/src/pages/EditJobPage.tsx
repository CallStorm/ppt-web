import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type {
  EditTargetsResponse,
  PostRevisionResponse,
  RevisionItem,
} from '../api/types'
import { notifyError, notifySuccess } from '../stores/toastStore'

const MAX_COMMENT = 1000

export function EditJobPage() {
  const { id: jobId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [comments, setComments] = useState<Record<number, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const targetsQ = useQuery({
    queryKey: ['job', jobId, 'edit-targets'],
    queryFn: () =>
      api<EditTargetsResponse>('GET', `/api/jobs/${jobId}/edit-targets`),
    enabled: !!jobId,
  })

  const slides = targetsQ.data?.slides ?? []
  const isEditable = targetsQ.data?.editable ?? false
  const reason = targetsQ.data?.reason ?? null

  const filled = (() => {
    const out: RevisionItem[] = []
    for (const [k, v] of Object.entries(comments)) {
      const trimmed = (v ?? '').trim()
      if (trimmed) {
        out.push({ slide_index: Number(k), comment: trimmed.slice(0, MAX_COMMENT) })
      }
    }
    return out
  })()
  const canSubmit =
    isEditable && filled.length > 0 && confirmed && !submitting

  const handleSubmit = async () => {
    if (!jobId) return
    if (filled.length === 0) {
      notifyError('请至少填写一条修改意见')
      return
    }
    if (!confirmed) {
      notifyError('请勾选确认后再提交')
      return
    }
    setSubmitting(true)
    try {
      const res = await api<PostRevisionResponse>('POST', `/api/jobs/${jobId}/revisions`, {
        items: filled,
      })
      notifySuccess(`修改任务已创建，正在排队…`)
      navigate(`/jobs/${res.revision_job_id}`)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            编辑已完成的 PPT
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            在要改的页下面填写修改意见。改完不满意可再次点击「编辑」重新提交。本轮只跑一次。
          </p>
        </div>
        <Link
          to={`/jobs/${jobId}`}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          返回任务详情
        </Link>
      </header>

      {targetsQ.isLoading ? (
        <div className="rounded-lg border border-slate-200 p-8 text-center text-slate-500 dark:border-slate-700">
          加载中…
        </div>
      ) : targetsQ.error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
          无法加载可编辑的页：{String(targetsQ.error)}
        </div>
      ) : !isEditable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <h2 className="text-base font-medium">该任务暂不可编辑</h2>
          <p className="mt-1 text-sm">{reason ?? '请确认任务状态为已完成'}</p>
        </div>
      ) : (
        <>
          {reason && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              {reason}
            </div>
          )}

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
                      setComments((prev) => ({
                        ...prev,
                        [sl.index]: e.target.value.slice(0, MAX_COMMENT),
                      }))
                    }
                    placeholder={`例如：把字号加大 / 换一张更稳重的图 / 删掉这一行`}
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

          <footer className="sticky bottom-0 -mx-6 mt-2 border-t border-slate-200 bg-white/90 px-6 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-gemini-500 focus:ring-gemini-500"
                />
                我已检查全部 {slides.length} 张图，提交后将扣 1 个积分
              </label>
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  已填意见：<b className="text-slate-700 dark:text-slate-200">{filled.length}</b> / {slides.length}
                </span>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="rounded-md bg-gemini-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gemini-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? '提交中…' : '提交修改'}
                </button>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  )
}
