import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { notifyError, notifySuccess } from '../stores/toastStore'
import { JOBS_KEY } from '../hooks/useJobs'
import { FileUploadZone } from '../components/jobs/FileUploadZone'
import { VisualStyleChips } from '../components/jobs/VisualStyleChips'
import { ColorPaletteStrip } from '../components/jobs/ColorPaletteStrip'
import { ImageStrategyCards } from '../components/jobs/ImageStrategyCards'
import {
  getDefaultModelInfo,
  invalidateDefaultModelCache,
  type ModelInfo,
} from '../components/jobs/AiOptimizeButton'
import {
  AUDIENCE_OPTIONS,
  CANVAS_OPTIONS,
  DEFAULT_JOB_OPTIONS,
  FORMULA_POLICY_OPTIONS,
  ICON_STRATEGY_OPTIONS,
  LANGUAGE_OPTIONS,
  MODE_OPTIONS,
  PAGE_COUNT_MAX,
  PAGE_COUNT_MIN,
  SCENARIO_OPTIONS,
  TONE_OPTIONS,
  type JobOptions,
  type JobVisualStyle,
} from '../lib/jobOptions'
import { pickHint } from '../lib/aiHints'

const SELECT_CLASS =
  'w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800'

function OptionSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  className = '',
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={SELECT_CLASS}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const PAGE_COUNT_OPTIONS = Array.from(
  { length: PAGE_COUNT_MAX - PAGE_COUNT_MIN + 1 },
  (_, i) => {
    const n = PAGE_COUNT_MIN + i
    return { value: String(n), label: `${n} 页` }
  },
)

type CreateMode = 'topic' | 'document'

const PANEL_CLASS =
  'rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/40'

const SECTION_HEADER =
  'flex w-full items-center justify-between text-left text-sm font-medium text-slate-700 dark:text-slate-200'

export function NewJobPage() {
  const quota = useAuthStore((s) => s.quota)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [projectName, setProjectName] = useState('')
  const [options, setOptions] = useState<JobOptions>(DEFAULT_JOB_OPTIONS)
  const [coreTopic, setCoreTopic] = useState('')
  const [outlineText, setOutlineText] = useState('')
  const [keyPointsText, setKeyPointsText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)

  // 内容输入模式 + 分节折叠状态
  const [mode, setMode] = useState<CreateMode>('topic')
  const [openTone, setOpenTone] = useState(false)
  const [openImagery, setOpenImagery] = useState(false)
  const [openAdvanced, setOpenAdvanced] = useState(false)

  const canSubmit = useMemo(
    () =>
      !submitting &&
      !autoFilling &&
      quota() > 0 &&
      coreTopic.trim().length > 0 &&
      (mode === 'topic' || files.length > 0),
    [submitting, autoFilling, quota, coreTopic, mode, files],
  )

  const set = <K extends keyof JobOptions>(key: K, v: JobOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: v }))

  // 智能填充成功后自动展开 ②
  const onAutoFillSuccess = () => setOpenTone(true)

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('prompt', coreTopic.trim())
      if (projectName.trim()) fd.append('project_name', projectName.trim())
      fd.append('language', options.language)
      fd.append('scenario', options.scenario)
      fd.append('audience', options.audience)
      fd.append('tone', options.tone)
      fd.append('page_count', String(options.page_count))
      fd.append('canvas', options.canvas)
      fd.append('mode', options.mode)
      fd.append('visual_style', options.visual_style ?? 'auto')
      fd.append('color_mode', options.color_mode)
      if (options.brand_hex) fd.append('brand_hex', options.brand_hex)
      if (options.industry) fd.append('industry', options.industry)
      fd.append('image_strategy', options.image_strategy)
      if (coreTopic.trim()) fd.append('core_topic', coreTopic.trim())
      if (outlineText.trim()) fd.append('outline', outlineText)
      if (keyPointsText.trim()) fd.append('key_points', keyPointsText)
      fd.append('icon_strategy', options.icon_strategy)
      fd.append('formula_policy', options.formula_policy)
      fd.append('include_speaker_notes', options.include_speaker_notes ? 'true' : 'false')
      fd.append('split_mode', options.split_mode ? 'true' : 'false')
      for (const f of files) fd.append('files', f, f.name)
      const job = await api<{ id: string }>('POST', '/api/jobs', fd)
      notifySuccess('任务已创建，排队中…')
      invalidateDefaultModelCache()
      await qc.invalidateQueries({ queryKey: JOBS_KEY })
      navigate(`/jobs/${job.id}`)
    } catch (e) {
      notifyError('创建失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  // ── 智能填充（autofill 逻辑完全保留；改名为局部函数 + 加 onSuccess 钩子） ──
  const applySuggestedOptions = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const s = raw as Record<string, unknown>
    setOptions((o) => {
      const next = { ...o }
      const pick = <T extends string>(v: unknown, opts: { value: T }[]) =>
        typeof v === 'string' && opts.some((x) => x.value === (v as T)) ? (v as T) : undefined
      const lang = pick(s.language, LANGUAGE_OPTIONS)
      const sc = pick(s.scenario, SCENARIO_OPTIONS)
      const aud = pick(s.audience, AUDIENCE_OPTIONS)
      const tn = pick(s.tone, TONE_OPTIONS)
      if (lang) next.language = lang
      if (sc) next.scenario = sc
      if (aud) next.audience = aud
      if (tn) next.tone = tn
      if (typeof s.page_count === 'number' && s.page_count >= 3 && s.page_count <= 30) {
        next.page_count = s.page_count
      }
      return next
    })
  }

  const applyStyle = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const s = raw as Record<string, unknown>
    setOptions((o) => {
      const next = { ...o }
      if (typeof s.visual_style === 'string' && s.visual_style) {
        next.visual_style = s.visual_style as JobOptions['visual_style']
      }
      if (typeof s.color_mode === 'string') {
        next.color_mode = s.color_mode as JobOptions['color_mode']
      }
      next.brand_hex = typeof s.brand_hex === 'string' && s.brand_hex ? s.brand_hex : null
      if (typeof s.industry === 'string' && s.industry) {
        next.industry = s.industry as JobOptions['industry']
      } else {
        next.industry = null
      }
      if (typeof s.image_strategy === 'string') {
        next.image_strategy = s.image_strategy as JobOptions['image_strategy']
      }
      return next
    })
  }

  const onAutoFill = async () => {
    if (autoFilling) return
    if (mode === 'topic' && !coreTopic.trim()) return
    if (mode === 'document' && files.length === 0) return
    setAutoFilling(true)
    try {
      const m = await getDefaultModelInfo()
      if (!m.configured) {
        notifyError(m.message || '未配置默认模型，请到 管理后台 → 应用设置 配置')
        return
      }
      const fd = new FormData()
      fd.append('mode', mode)
      fd.append('scenario', options.scenario)
      fd.append('audience', options.audience)
      fd.append('tone', options.tone)
      fd.append('language', options.language)
      if (mode === 'topic') {
        fd.append('core_topic', coreTopic.trim())
      } else {
        for (const f of files) fd.append('files', f, f.name)
      }
      const resp = (await api('POST', '/api/app/llm/auto-fill', fd)) as Record<string, unknown>
      if (mode === 'document') {
        const ct = (resp.core_topic as string | undefined)?.trim()
        if (ct) setCoreTopic(ct)
      }
      const kp = resp.key_points
      if (Array.isArray(kp) && kp.length > 0) {
        setKeyPointsText(kp.map((x) => String(x).trim()).filter(Boolean).join('\n'))
      }
      const outline = resp.outline
      if (Array.isArray(outline) && outline.length > 0) {
        setOutlineText(outline.map((x) => String(x).trim()).filter(Boolean).join('\n'))
      }
      applySuggestedOptions(resp.suggested_options)
      applyStyle(resp.style)
      const modelUsed = (resp.model_used as ModelInfo | undefined) ?? m
      notifySuccess(`智能填充完成（${modelUsed.name ?? '模型'}）`)
      onAutoFillSuccess()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const match = msg.match(/\d+:\s*({.*})/s)
      if (match) {
        try {
          const detail = JSON.parse(match[1])
          notifyError(`智能填充失败：${detail.message ?? msg}`)
          return
        } catch {
          /* fall through */
        }
      }
      notifyError(`智能填充失败：${msg}`)
    } finally {
      setAutoFilling(false)
    }
  }

  const canAutoFill =
    !autoFilling && (mode === 'topic' ? coreTopic.trim().length > 0 : files.length > 0)

  // AI 提示气泡：仅当 core_topic 命中关键词时显示
  const hint = pickHint(coreTopic)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 dark:bg-gradient-to-b dark:from-slate-950 dark:to-slate-900">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">创建任务</h1>
        <Link to="/" className="text-sm text-slate-500 hover:text-gemini-600">
          取消
        </Link>
      </div>

      <div className="space-y-4">
        {/* ── ① 内容源（始终展开） ── */}
        <section className={PANEL_CLASS}>
          <button
            type="button"
            disabled
            aria-disabled
            className={SECTION_HEADER + ' cursor-default'}
          >
            <span>① 内容源</span>
          </button>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs text-slate-500">项目名称（可选）</span>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                placeholder="例：Q1 产品发布"
              />
            </label>

            {/* 模式切换 */}
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
              {(['topic', 'document'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded px-4 py-1.5 text-sm transition ${
                    mode === m
                      ? 'bg-gemini-600 text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  {m === 'topic' ? '主题输入' : '文档输入'}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {mode === 'topic'
                ? '输入一句话主题，AI 据此生成整套方案。'
                : '上传文档作为素材，AI 解析文档后提炼主题并生成整套方案。'}
            </p>

            {mode === 'document' && (
              <FileUploadZone files={files} onChange={setFiles} />
            )}

            <div>
              <span className="text-xs text-slate-500">
                核心主题 <span className="text-rose-500">*</span>
                {mode === 'document' && (
                  <span className="ml-1 text-slate-400">（可点下方智能填充自动提取，也可手动编辑）</span>
                )}
              </span>
              <textarea
                value={coreTopic}
                onChange={(e) => setCoreTopic(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                placeholder="一句话描述这个 PPT 的主题。例：介绍我们的新产品 X，面向企业客户，核心是提升效率。"
              />
            </div>

            {hint && (
              <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
            )}

            <button
              type="button"
              onClick={onAutoFill}
              disabled={!canAutoFill}
              className="w-full rounded-md border border-gemini-300 bg-gemini-50 px-3 py-2 text-sm font-medium text-gemini-700 hover:bg-gemini-100 disabled:opacity-50 dark:border-gemini-700 dark:bg-gemini-950 dark:text-gemini-200 dark:hover:bg-gemini-900"
            >
              {autoFilling
                ? '智能填充中…'
                : mode === 'topic'
                  ? '✨ 智能填充（基于主题生成大纲 / 重点 / 设置 / 风格）'
                  : '✨ 智能填充（解析文档，生成主题 / 大纲 / 重点 / 设置 / 风格）'}
            </button>

            <div>
              <span className="text-xs text-slate-500">章节大纲（每行一个标题）</span>
              <textarea
                value={outlineText}
                onChange={(e) => setOutlineText(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
                placeholder={'封面\n第一章 背景与挑战\n第二章 解决方案\n第三章 实施路径\n第四章 预期收益\n总结'}
              />
            </div>

            <div>
              <span className="text-xs text-slate-500">重点强调（每行一个要点）</span>
              <textarea
                value={keyPointsText}
                onChange={(e) => setKeyPointsText(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
                placeholder={'用户增长 40%\nNPS 突破 60\n节省成本 30%'}
              />
            </div>
          </div>
        </section>

        {/* ── ② 视觉调性（默认折叠） ── */}
        <section className={PANEL_CLASS}>
          <button
            type="button"
            onClick={() => setOpenTone((v) => !v)}
            className={SECTION_HEADER}
          >
            <span>② 视觉调性</span>
            <span className="text-slate-400">{openTone ? '▾' : '▸'}</span>
          </button>
          {openTone && (
            <div className="mt-3 space-y-4">
              {/* 5 个基础字段（从 ① 移过来） */}
              <div>
                <span className="text-xs text-slate-500">基础设置</span>
                <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <OptionSelect label="语言" options={LANGUAGE_OPTIONS} value={options.language} onChange={(v) => set('language', v)} className="flex-1 min-w-[6rem]" />
                  <OptionSelect label="场景" options={SCENARIO_OPTIONS} value={options.scenario} onChange={(v) => set('scenario', v)} className="flex-1 min-w-[7rem]" />
                  <OptionSelect label="受众" options={AUDIENCE_OPTIONS} value={options.audience} onChange={(v) => set('audience', v)} className="flex-1 min-w-[7rem]" />
                  <OptionSelect label="语调" options={TONE_OPTIONS} value={options.tone} onChange={(v) => set('tone', v)} className="flex-1 min-w-[6rem]" />
                  <label className="flex w-20 flex-none flex-col gap-0.5">
                    <span className="text-xs text-slate-500">页数</span>
                    <select
                      value={String(options.page_count)}
                      onChange={(e) => set('page_count', parseInt(e.target.value, 10) as JobOptions['page_count'])}
                      className={SELECT_CLASS}
                    >
                      {PAGE_COUNT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* 视觉风格 chip 网格 */}
              <div>
                <span className="text-xs text-slate-500">视觉风格</span>
                <div className="mt-1">
                  <VisualStyleChips
                    value={(options.visual_style ?? 'auto') as JobVisualStyle}
                    onChange={(v) => set('visual_style', v)}
                    coreTopic={coreTopic}
                  />
                </div>
              </div>

              {/* 配色 */}
              <div>
                <span className="text-xs text-slate-500">配色</span>
                <div className="mt-1">
                  <ColorPaletteStrip
                    value={options.color_mode}
                    onChange={(v) => set('color_mode', v)}
                    brandHex={options.brand_hex}
                    onBrandHexChange={(v) => set('brand_hex', v)}
                    industry={options.industry}
                    onIndustryChange={(v) => set('industry', v)}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── ③ 素材策略（默认折叠） ── */}
        <section className={PANEL_CLASS}>
          <button
            type="button"
            onClick={() => setOpenImagery((v) => !v)}
            className={SECTION_HEADER}
          >
            <span>③ 素材策略</span>
            <span className="text-slate-400">{openImagery ? '▾' : '▸'}</span>
          </button>
          {openImagery && (
            <div className="mt-3">
              <span className="text-xs text-slate-500">图片策略</span>
              <div className="mt-1">
                <ImageStrategyCards
                  value={options.image_strategy}
                  onChange={(v) => set('image_strategy', v)}
                />
              </div>
            </div>
          )}
        </section>

        {/* ── 高级（底部齿轮） ── */}
        <div>
          <button
            type="button"
            onClick={() => setOpenAdvanced((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <span>{openAdvanced ? '▾' : '⚙'}</span>
            <span>高级（画布 / 叙事模式 / 图标 / 公式 / 备注）</span>
          </button>
          {openAdvanced && (
            <div className="mt-3 space-y-3 rounded-md bg-slate-50 p-3 dark:bg-slate-900/60">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <OptionSelect label="画布" options={CANVAS_OPTIONS} value={options.canvas} onChange={(v) => set('canvas', v)} />
                <OptionSelect label="叙事模式" options={MODE_OPTIONS} value={options.mode} onChange={(v) => set('mode', v)} />
                <OptionSelect label="图标策略" options={ICON_STRATEGY_OPTIONS} value={options.icon_strategy} onChange={(v) => set('icon_strategy', v)} />
                <OptionSelect label="公式渲染" options={FORMULA_POLICY_OPTIONS} value={options.formula_policy} onChange={(v) => set('formula_policy', v)} />
              </div>
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={options.include_speaker_notes} onChange={(e) => set('include_speaker_notes', e.target.checked)} />
                  <span>生成演讲者备注</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={options.split_mode} onChange={(e) => set('split_mode', e.target.checked)} />
                  <span>长 deck 分阶段模式</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {quota() <= 0 && (
          <p className="text-sm text-rose-600">Credits 不足，无法创建任务</p>
        )}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="w-full rounded-md bg-gemini-600 py-2.5 text-sm font-medium text-white hover:bg-gemini-700 disabled:opacity-50"
        >
          {submitting ? '提交中…' : '创建任务'}
        </button>
      </div>
    </div>
  )
}
