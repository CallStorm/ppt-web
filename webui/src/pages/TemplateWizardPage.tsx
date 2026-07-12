import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { notifyError, notifySuccess } from '../stores/toastStore'
import type { TemplateCategory, TemplateKind } from '../lib/jobOptions'
import {
  type BriefFieldErrors,
  hasBriefErrors,
  normalizeSlugInput,
  validateBriefFields,
} from '../lib/templateBriefValidation'
import { panelClassName } from '../components/ui/Card'

type AnalysisResult = {
  staging_id: string
  analysis: {
    page_count: number
    canvas_format: string
    canvas_width: number
    canvas_height: number
    canvas_viewbox: string
    theme_colors: string[]
    fonts: string[]
    master_count: number
    layout_count: number
    page_type_candidates: string[]
    primary_color: string | null
    cover_preview: string | null
    title_guess: string
    slug_guess: string
    native_structure_mode: string
    theme_mode: string
  }
}

type BriefForm = {
  staging_id: string
  slug: string
  display_name: string
  kind: TemplateKind
  scope?: 'global'
  category_id?: string
  canvas_format: string
  canvas_width: number
  canvas_height: number
  canvas_viewbox: string
  replication_mode: string
  native_structure_mode: string
  visual_fidelity: string
  theme_mode: string
  summary: string
  keywords: string[]
  primary_color: string | null
  page_count: number
}

const STEPS = ['上传参考', '分析结果', '配置参数', '确认', '生成中']

function fieldClass(hasError: boolean) {
  return `mt-1 w-full rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-800 ${
    hasError ? 'border-rose-500 dark:border-rose-500' : ''
  }`
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{message}</p>
}

function StepNav({
  onPrev,
  onNext,
  nextLabel,
  nextDisabled,
}: {
  onPrev?: () => void
  onNext: () => void
  nextLabel: string
  nextDisabled?: boolean
}) {
  return (
    <div className="mt-4 flex gap-2">
      {onPrev && (
        <button
          type="button"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
          onClick={onPrev}
        >
          上一步
        </button>
      )}
      <button
        type="button"
        disabled={nextDisabled}
        className="rounded-md bg-gemini-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        onClick={onNext}
      >
        {nextLabel}
      </button>
    </div>
  )
}

export function TemplateWizardPage() {
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const [step, setStep] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [dbId, setDbId] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<BriefFieldErrors>({})

  const [brief, setBrief] = useState<BriefForm | null>(null)

  const categoriesQ = useQuery({
    queryKey: ['template-categories'],
    queryFn: () => api<{ categories: TemplateCategory[] }>('GET', '/api/templates/categories'),
    enabled: isAdmin(),
  })
  const adminCategories = (categoriesQ.data?.categories ?? []).filter((c) => c.scope === 'admin')

  const maxReachableStep = step >= 4 ? 4 : step

  const goToStep = (target: number) => {
    if (target < 0 || target >= step || step >= 4) return
    setFieldErrors({})
    setStep(target)
  }

  const runBriefValidation = (b: BriefForm): BriefFieldErrors =>
    validateBriefFields(b, { isAdmin: isAdmin() })

  const confirmSummary = useMemo(() => {
    if (!brief) return null
    return {
      显示名称: brief.display_name,
      Slug: brief.slug,
      类型: brief.kind,
      复刻模式: brief.replication_mode,
      原生结构: brief.native_structure_mode,
      视觉保真: brief.visual_fidelity,
      主题: brief.theme_mode,
      关键词: brief.keywords.join(', '),
      描述: brief.summary,
      ...(brief.scope === 'global' ? { 发布范围: '全局模板', 分类: brief.category_id } : { 发布范围: '我的模板' }),
    }
  }, [brief])

  const uploadPptx = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file, file.name)
      const res = await api<AnalysisResult>('POST', '/api/templates/analyze', fd)
      setAnalysis(res)
      const a = res.analysis
      setBrief({
        staging_id: res.staging_id,
        slug: a.slug_guess,
        display_name: a.title_guess,
        kind: 'deck',
        canvas_format: a.canvas_format,
        canvas_width: a.canvas_width,
        canvas_height: a.canvas_height,
        canvas_viewbox: a.canvas_viewbox,
        replication_mode: 'standard',
        native_structure_mode: a.native_structure_mode,
        visual_fidelity: 'literal',
        theme_mode: a.theme_mode,
        summary: `适用于 ${a.title_guess} 风格演示`,
        keywords: ['general', 'deck'],
        primary_color: a.primary_color,
        page_count: a.page_count,
      })
      setFieldErrors({})
      setStep(1)
    } catch (e) {
      notifyError('分析失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setUploading(false)
    }
  }

  const advanceToConfirm = () => {
    if (!brief) return
    const errors = runBriefValidation(brief)
    setFieldErrors(errors)
    if (hasBriefErrors(errors)) {
      notifyError('请修正标红字段后再继续')
      return
    }
    setStep(3)
  }

  const startCreate = async () => {
    if (!brief) return
    const errors = runBriefValidation(brief)
    setFieldErrors(errors)
    if (hasBriefErrors(errors)) {
      notifyError('请修正标红字段后再提交')
      setStep(2)
      return
    }
    setSubmitting(true)
    try {
      const res = await api<{ template: { db_id: string }; job_id: string }>(
        'POST',
        '/api/templates',
        brief,
      )
      setDbId(res.template.db_id)
      setJobId(res.job_id)
      setStep(4)
      notifySuccess('已开始制作模板')
    } catch (e) {
      notifyError('创建失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  const pollStatus = async () => {
    if (!dbId) return
    try {
      const res = await api<{ template: { status: string }; job_status: string | null }>(
        'GET',
        `/api/templates/records/${dbId}/status`,
      )
      if (res.template.status === 'ready') {
        notifySuccess('模板制作完成')
        navigate('/templates?tab=tasks')
      } else if (res.template.status === 'failed') {
        notifyError('模板制作失败')
      }
    } catch {
      /* ignore poll errors */
    }
  }

  const updateBrief = (patch: Partial<BriefForm>) => {
    if (!brief) return
    const next = { ...brief, ...patch }
    if (patch.replication_mode === 'mirror') {
      next.native_structure_mode = 'template'
    }
    setBrief(next)
    if (Object.keys(fieldErrors).length > 0) {
      setFieldErrors(runBriefValidation(next))
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/templates" className="text-xs text-slate-500 hover:text-gemini-600">
        ← 返回模板库
      </Link>
      <h1 className="mt-2 text-xl font-semibold">制作模板</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        {STEPS.map((label, i) => {
          const visited = i < maxReachableStep
          const clickable = visited && step < 4
          return (
            <button
              key={label}
              type="button"
              disabled={!clickable}
              title={clickable ? `返回：${label}` : undefined}
              className={`rounded-full px-2.5 py-1 text-[11px] ${
                i === step
                  ? 'bg-gemini-600 text-white'
                  : visited
                    ? 'bg-gemini-100 text-gemini-700 hover:bg-gemini-200 dark:bg-gemini-900/40 dark:hover:bg-gemini-900/60'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
              } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
              onClick={() => goToStep(i)}
            >
              {i + 1}. {label}
            </button>
          )
        })}
      </div>

      <section className={`mt-6 ${panelClassName}`}>
        {step === 0 && (
          <div>
            <h2 className="text-sm font-medium">Step 1 — 上传参考 PPTX</h2>
            <p className="mt-1 text-xs text-slate-500">上传一份带品牌风格的参考演示文稿</p>
            {analysis && (
              <p className="mt-2 text-xs text-slate-500">
                已分析「{analysis.analysis.title_guess}」，重新上传将覆盖当前分析结果。
              </p>
            )}
            <label className="mt-4 flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-slate-200 px-6 py-10 text-sm dark:border-slate-700">
              {uploading ? '分析中…' : '点击选择 .pptx 文件'}
              <input
                type="file"
                accept=".pptx"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadPptx(f)
                }}
              />
            </label>
            {analysis && (
              <StepNav onNext={() => setStep(1)} nextLabel="跳过上传，查看分析结果" />
            )}
          </div>
        )}

        {step === 1 && analysis && brief && (
          <div className="space-y-4 text-sm">
            <h2 className="font-medium">Step 2 — 智能分析</h2>
            <ul className="space-y-1 text-slate-600 dark:text-slate-300">
              <li>页数：{analysis.analysis.page_count}</li>
              <li>
                画布：{analysis.analysis.canvas_format} ({analysis.analysis.canvas_width}×
                {analysis.analysis.canvas_height})
              </li>
              <li>Master / Layout：{analysis.analysis.master_count} / {analysis.analysis.layout_count}</li>
              {analysis.analysis.primary_color && (
                <li>主色：{analysis.analysis.primary_color}</li>
              )}
            </ul>
            <StepNav
              onPrev={() => setStep(0)}
              onNext={() => setStep(2)}
              nextLabel="下一步：配置参数"
            />
          </div>
        )}

        {step === 2 && brief && (
          <div className="space-y-3 text-sm">
            <h2 className="font-medium">Step 3 — 配置 Brief</h2>
            <label className="block">
              显示名称
              <span className="ml-1 text-xs text-slate-400">（支持中文）</span>
              <input
                className={fieldClass(!!fieldErrors.display_name)}
                value={brief.display_name}
                onChange={(e) => updateBrief({ display_name: e.target.value })}
              />
              <FieldError message={fieldErrors.display_name} />
            </label>
            <label className="block">
              Slug（目录名）
              <span className="ml-1 text-xs text-slate-400">（仅英文小写，作为模板目录名）</span>
              <input
                className={fieldClass(!!fieldErrors.slug)}
                value={brief.slug}
                placeholder="my_brand_deck"
                onChange={(e) => updateBrief({ slug: normalizeSlugInput(e.target.value) })}
              />
              <FieldError message={fieldErrors.slug} />
            </label>
            <label className="block">
              类型
              <select
                className={fieldClass(!!fieldErrors.kind)}
                value={brief.kind}
                onChange={(e) => updateBrief({ kind: e.target.value as TemplateKind })}
              >
                <option value="deck">完整套版（deck）</option>
                <option value="layout">结构版式（layout）</option>
              </select>
              <FieldError message={fieldErrors.kind} />
            </label>
            {isAdmin() && (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={brief.scope === 'global'}
                    onChange={(e) =>
                      updateBrief({
                        scope: e.target.checked ? 'global' : undefined,
                        category_id: e.target.checked ? adminCategories[0]?.id : undefined,
                      })
                    }
                  />
                  发布为全局模板（管理员，所有用户可见；不勾选则仅「我的模板」）
                </label>
                {brief.scope === 'global' && (
                  <label className="block">
                    分类
                    <select
                      className={fieldClass(!!fieldErrors.category_id)}
                      value={brief.category_id || ''}
                      onChange={(e) => updateBrief({ category_id: e.target.value })}
                    >
                      {adminCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <FieldError message={fieldErrors.category_id} />
                  </label>
                )}
              </>
            )}
            <label className="block">
              复刻模式
              <select
                className={fieldClass(!!fieldErrors.replication_mode)}
                value={brief.replication_mode}
                onChange={(e) => updateBrief({ replication_mode: e.target.value })}
              >
                <option value="standard">standard（标准重建）</option>
                <option value="fidelity">fidelity（逐页采样）</option>
                <option value="mirror">mirror（逐页镜像）</option>
              </select>
              <FieldError message={fieldErrors.replication_mode} />
            </label>
            <label className="block">
              原生结构策略
              <select
                className={fieldClass(!!fieldErrors.native_structure_mode)}
                value={brief.native_structure_mode}
                disabled={brief.replication_mode === 'mirror'}
                onChange={(e) => updateBrief({ native_structure_mode: e.target.value })}
              >
                <option value="preserve">preserve（保留源稿结构）</option>
                <option value="template">template（重建版式）</option>
              </select>
              {brief.replication_mode === 'mirror' && (
                <p className="mt-0.5 text-xs text-slate-400">mirror 模式固定使用 template</p>
              )}
              <FieldError message={fieldErrors.native_structure_mode} />
            </label>
            <label className="block">
              视觉保真
              <select
                className={fieldClass(!!fieldErrors.visual_fidelity)}
                value={brief.visual_fidelity}
                onChange={(e) => updateBrief({ visual_fidelity: e.target.value })}
              >
                <option value="literal">literal（尽量还原）</option>
                <option value="adapted">adapted（允许演化）</option>
              </select>
              <FieldError message={fieldErrors.visual_fidelity} />
            </label>
            <label className="block">
              关键词
              <span className="ml-1 text-xs text-slate-400">（英文，逗号分隔）</span>
              <input
                className={fieldClass(!!fieldErrors.keywords)}
                value={brief.keywords.join(', ')}
                placeholder="general, deck, corporate"
                onChange={(e) =>
                  updateBrief({
                    keywords: e.target.value
                      .split(',')
                      .map((s) => normalizeSlugInput(s.trim()))
                      .filter(Boolean),
                  })
                }
              />
              <FieldError message={fieldErrors.keywords} />
            </label>
            <label className="block">
              一句话描述
              <span className="ml-1 text-xs text-slate-400">（支持中文）</span>
              <textarea
                className={fieldClass(!!fieldErrors.summary)}
                rows={2}
                value={brief.summary}
                onChange={(e) => updateBrief({ summary: e.target.value })}
              />
              <FieldError message={fieldErrors.summary} />
            </label>
            <StepNav
              onPrev={() => setStep(1)}
              onNext={advanceToConfirm}
              nextLabel="下一步：确认"
            />
          </div>
        )}

        {step === 3 && brief && confirmSummary && (
          <div className="space-y-3 text-sm">
            <h2 className="font-medium">Step 4 — 确认</h2>
            <dl className="space-y-2 rounded bg-slate-50 p-3 text-xs dark:bg-slate-900">
              {Object.entries(confirmSummary).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7rem_1fr] gap-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="break-all">{String(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-slate-500">确认后将消耗 1 credit 并开始后台制作。</p>
            <StepNav
              onPrev={() => setStep(2)}
              onNext={startCreate}
              nextLabel={submitting ? '提交中…' : '开始制作'}
              nextDisabled={submitting}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 text-sm">
            <h2 className="font-medium">Step 5 — 生成中</h2>
            <p className="text-slate-600 dark:text-slate-300">
              模板正在后台制作，通常需要数分钟。
            </p>
            {jobId && (
              <Link to={`/jobs/${jobId}`} className="text-gemini-600 hover:underline">
                查看任务进度 →
              </Link>
            )}
            <button
              type="button"
              className="block rounded-md border px-3 py-1.5 text-xs"
              onClick={pollStatus}
            >
              刷新状态
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
