import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type {
  ContentPreset,
  EditTargetsResponse,
  PostRevisionResponse,
  RevisionRequest,
} from '../api/types'
import { notifyError, notifySuccess } from '../stores/toastStore'
import {
  EditModeTabs,
  EditPageHeader,
  type EditMode,
} from '../components/edit/EditModeTabs'
import { DeckContextSidebar } from '../components/edit/DeckContextSidebar'
import {
  buildGlobalRevisionPayload,
  GlobalEditPanel,
} from '../components/edit/GlobalEditPanel'
import {
  collectPerPageItems,
  PerPageEditPanel,
} from '../components/edit/PerPageEditPanel'
import { EditSubmitFooter } from '../components/edit/EditSubmitFooter'
import type { JobVisualStyle } from '../lib/jobOptions'

export function EditJobPage() {
  const { id: jobId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialMode: EditMode =
    searchParams.get('mode') === 'global' ? 'global' : 'per_page'
  const [mode, setMode] = useState<EditMode>(initialMode)

  const [comments, setComments] = useState<Record<number, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [globalKind, setGlobalKind] = useState<
    'colors' | 'typography' | 'visual_style' | 'content' | 'custom'
  >('custom')
  const [colorDraft, setColorDraft] = useState<Record<string, string>>({})
  const [fontFamily, setFontFamily] = useState('')
  const [visualStyle, setVisualStyle] = useState<JobVisualStyle>('swiss-minimal')
  const [contentPreset, setContentPreset] = useState<ContentPreset | null>(null)
  const [contentComment, setContentComment] = useState('')
  const [customComment, setCustomComment] = useState('')

  const targetsQ = useQuery({
    queryKey: ['job', jobId, 'edit-targets'],
    queryFn: () =>
      api<EditTargetsResponse>('GET', `/api/jobs/${jobId}/edit-targets`),
    enabled: !!jobId,
  })

  const slides = targetsQ.data?.slides ?? []
  const isEditable = targetsQ.data?.editable ?? false
  const reason = targetsQ.data?.reason ?? null
  const specSummary = targetsQ.data?.spec_summary ?? null

  const filledPerPage = useMemo(() => collectPerPageItems(comments), [comments])

  const globalPayload = useMemo(
    () =>
      buildGlobalRevisionPayload(globalKind, {
        colorDraft,
        fontFamily,
        visualStyle,
        contentPreset,
        contentComment,
        customComment,
      }, specSummary),
    [
      globalKind,
      colorDraft,
      fontFamily,
      visualStyle,
      contentPreset,
      contentComment,
      customComment,
      specSummary,
    ],
  )

  const canSubmit =
    isEditable &&
    confirmed &&
    !submitting &&
    (mode === 'per_page'
      ? filledPerPage.length > 0
      : globalPayload !== null)

  const handleModeChange = (m: EditMode) => {
    setMode(m)
    setSearchParams(m === 'global' ? { mode: 'global' } : {}, { replace: true })
  }

  const handleSubmit = async () => {
    if (!jobId) return
    if (!confirmed) {
      notifyError('请勾选确认后再提交')
      return
    }

    let body: RevisionRequest
    if (mode === 'per_page') {
      if (filledPerPage.length === 0) {
        notifyError('请至少填写一条修改意见')
        return
      }
      body = { mode: 'per_page', items: filledPerPage }
    } else {
      if (!globalPayload) {
        notifyError('请完成全局修改表单')
        return
      }
      body = { mode: 'global', global_revision: globalPayload }
    }

    setSubmitting(true)
    try {
      const res = await api<PostRevisionResponse>(
        'POST',
        `/api/jobs/${jobId}/revisions`,
        body as unknown as Record<string, unknown>,
      )
      notifySuccess('修改任务已创建，正在排队…')
      navigate(`/jobs/${res.revision_job_id}`)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <EditPageHeader jobId={jobId ?? ''} />

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
          <EditModeTabs mode={mode} onChange={handleModeChange} />

          {reason && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              {reason}
            </div>
          )}

          {mode === 'per_page' ? (
            <PerPageEditPanel
              slides={slides}
              comments={comments}
              onCommentChange={(index, value) =>
                setComments((prev) => ({ ...prev, [index]: value }))
              }
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <GlobalEditPanel
                slides={slides}
                specSummary={specSummary}
                kind={globalKind}
                onKindChange={setGlobalKind}
                colorDraft={colorDraft}
                onColorDraftChange={(key, value) =>
                  setColorDraft((prev) => ({ ...prev, [key]: value }))
                }
                fontFamily={fontFamily}
                onFontFamilyChange={setFontFamily}
                visualStyle={visualStyle}
                onVisualStyleChange={setVisualStyle}
                contentPreset={contentPreset}
                onContentPresetChange={setContentPreset}
                contentComment={contentComment}
                onContentCommentChange={setContentComment}
                customComment={customComment}
                onCustomCommentChange={setCustomComment}
              />
              <DeckContextSidebar slides={slides} specSummary={specSummary} />
            </div>
          )}

          <EditSubmitFooter
            mode={mode}
            slideCount={slides.length}
            filledCount={
              mode === 'per_page' ? filledPerPage.length : globalPayload ? 1 : 0
            }
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
            canSubmit={canSubmit}
            submitting={submitting}
            onSubmit={handleSubmit}
          />
        </>
      )}
    </div>
  )
}
