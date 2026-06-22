import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { notifyError, notifySuccess } from '../stores/toastStore'
import { JOBS_KEY } from '../hooks/useJobs'
import { FileUploadZone } from '../components/jobs/FileUploadZone'
import {
  AiOptimizeButton,
  invalidateDefaultModelCache,
} from '../components/jobs/AiOptimizeButton'
import {
  AUDIENCE_OPTIONS,
  CANVAS_OPTIONS,
  COLOR_MODE_OPTIONS,
  DEFAULT_JOB_OPTIONS,
  FORMULA_POLICY_OPTIONS,
  ICON_STRATEGY_OPTIONS,
  IMAGE_STRATEGY_OPTIONS,
  INDUSTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  MODE_OPTIONS,
  PAGE_COUNT_MAX,
  PAGE_COUNT_MIN,
  SCENARIO_OPTIONS,
  TONE_OPTIONS,
  VISUAL_STYLE_OPTIONS,
  type JobOptions,
  type JobVisualStyle,
} from '../lib/jobOptions'

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
  const [showAdvanced, setShowAdvanced] = useState(false)

  const canSubmit = useMemo(
    () => !submitting && !!coreTopic.trim() && quota() > 0,
    [submitting, coreTopic, quota],
  )

  const set = <K extends keyof JobOptions>(key: K, v: JobOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: v }))

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      // 把 core_topic 放到 prompt（向后兼容：旧后端也只要这个）
      fd.append('prompt', coreTopic.trim())
      if (projectName.trim()) fd.append('project_name', projectName.trim())

      // 基础 5 个
      fd.append('language', options.language)
      fd.append('scenario', options.scenario)
      fd.append('audience', options.audience)
      fd.append('tone', options.tone)
      fd.append('page_count', String(options.page_count))

      // 新增 Tier-1
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

      // 高级
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

  // ── AI 回调 ──
  // 把 suggested_options 应用到 options 状态（仅填已知枚举字段）
  const applySuggestedOptions = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const s = raw as Record<string, unknown>
    setOptions((o) => {
      const next = { ...o }
      if (typeof s.language === 'string' && LANGUAGE_OPTIONS.some((x) => x.value === s.language)) {
        next.language = s.language as JobOptions['language']
      }
      if (typeof s.scenario === 'string' && SCENARIO_OPTIONS.some((x) => x.value === s.scenario)) {
        next.scenario = s.scenario as JobOptions['scenario']
      }
      if (typeof s.audience === 'string' && AUDIENCE_OPTIONS.some((x) => x.value === s.audience)) {
        next.audience = s.audience as JobOptions['audience']
      }
      if (typeof s.tone === 'string' && TONE_OPTIONS.some((x) => x.value === s.tone)) {
        next.tone = s.tone as JobOptions['tone']
      }
      if (typeof s.page_count === 'number' && s.page_count >= 3 && s.page_count <= 30) {
        next.page_count = s.page_count
      }
      return next
    })
  }

  const onOptimizePrompt = (data: Record<string, unknown>) => {
    const text = (data.optimized_prompt as string | undefined)?.trim()
    if (text) setCoreTopic(text)
    const kp = data.key_points
    if (Array.isArray(kp) && kp.length > 0) {
      setKeyPointsText((prev) => (prev.trim() ? prev + '\n' : '') + kp.join('\n'))
    }
    // 顺便把 5 字段一起填（用户可手动改）
    applySuggestedOptions(data.suggested_options)
  }

  const onResuggestOptions = (data: Record<string, unknown>) => {
    // 只填 5 字段，不动 core_topic
    applySuggestedOptions(data.suggested_options)
  }
  const onGenerateOutline = (data: Record<string, unknown>) => {
    const lines = data.outline
    if (Array.isArray(lines) && lines.length > 0) {
      setOutlineText(lines.map((s) => String(s).trim()).filter(Boolean).join('\n'))
    }
  }
  const onSuggestStyle = (data: Record<string, unknown>) => {
    const list = data.suggestions
    if (!Array.isArray(list) || list.length === 0) return
    // 取第一条，自动应用
    const first = list[0] as Record<string, unknown>
    setOptions((o) => ({
      ...o,
      visual_style: (first.visual_style as JobVisualStyle) ?? o.visual_style,
      color_mode: (first.color_mode as JobOptions['color_mode']) ?? o.color_mode,
      brand_hex: (first.brand_hex as string | null) ?? o.brand_hex,
      industry: (first.industry as JobOptions['industry']) ?? o.industry,
      image_strategy: (first.image_strategy as JobOptions['image_strategy']) ?? o.image_strategy,
    }))
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">创建任务</h1>
        <Link to="/" className="text-sm text-slate-500 hover:text-gemini-600">
          取消
        </Link>
      </div>

      <div className="space-y-6">
        {/* ── ① 项目 ──────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">
            ① 项目
          </h2>
          <label className="block">
            <span className="text-xs text-slate-500">项目名称（可选）</span>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              placeholder="例：Q1 产品发布"
            />
          </label>
        </section>

        {/* ── ② 内容输入 ─────────────────────────────────────── */}
        <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">
            ② 内容输入
          </h2>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                核心主题 <span className="text-rose-500">*</span>
              </span>
              <AiOptimizeButton
                endpoint="optimize-prompt"
                body={{
                  core_topic: coreTopic.trim() || '(空)',
                  scenario: options.scenario,
                  audience: options.audience,
                  tone: options.tone,
                  language: options.language,
                }}
                label="优化描述"
                onResult={onOptimizePrompt}
                disabled={!coreTopic.trim()}
              />
            </div>
            <textarea
              value={coreTopic}
              onChange={(e) => setCoreTopic(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              placeholder="一句话描述这个 PPT 的主题。例：介绍我们的新产品 X，面向企业客户，核心是提升效率。"
            />
          </div>

          <FileUploadZone files={files} onChange={setFiles} />

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                推荐设置（语言 / 场景 / 受众 / 语调 / 页数）
              </span>
              <AiOptimizeButton
                endpoint="optimize-prompt"
                body={{
                  core_topic: coreTopic.trim() || '(空)',
                  scenario: options.scenario,
                  audience: options.audience,
                  tone: options.tone,
                  language: options.language,
                }}
                label="重新推荐"
                onResult={onResuggestOptions}
                disabled={!coreTopic.trim()}
              />
            </div>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <OptionSelect
                label="语言"
                options={LANGUAGE_OPTIONS}
                value={options.language}
                onChange={(v) => set('language', v)}
                className="flex-1 min-w-[6.5rem]"
              />
              <OptionSelect
                label="场景"
                options={SCENARIO_OPTIONS}
                value={options.scenario}
                onChange={(v) => set('scenario', v)}
                className="flex-1 min-w-[7.5rem]"
              />
              <OptionSelect
                label="受众"
                options={AUDIENCE_OPTIONS}
                value={options.audience}
                onChange={(v) => set('audience', v)}
                className="flex-1 min-w-[7.5rem]"
              />
              <OptionSelect
                label="语调"
                options={TONE_OPTIONS}
                value={options.tone}
                onChange={(v) => set('tone', v)}
                className="flex-1 min-w-[6.5rem]"
              />
              <label className="flex w-20 flex-none flex-col gap-0.5">
                <span className="text-xs text-slate-500">页数</span>
                <select
                  value={String(options.page_count)}
                  onChange={(e) =>
                    set('page_count', parseInt(e.target.value, 10) as JobOptions['page_count'])
                  }
                  className={SELECT_CLASS}
                >
                  {PAGE_COUNT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-500">章节大纲（每行一个标题）</span>
              <AiOptimizeButton
                endpoint="generate-outline"
                body={{
                  core_topic: coreTopic.trim() || '(空)',
                  page_count: options.page_count,
                  scenario: options.scenario,
                  audience: options.audience,
                  language: options.language,
                }}
                label="生成大纲"
                onResult={onGenerateOutline}
                disabled={!coreTopic.trim()}
              />
            </div>
            <textarea
              value={outlineText}
              onChange={(e) => setOutlineText(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
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
        </section>

        {/* ── ③ 设计偏好 ─────────────────────────────────────── */}
        <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">
              ③ 设计偏好
            </h2>
            <AiOptimizeButton
              endpoint="suggest-style"
              body={{
                core_topic: coreTopic.trim() || '(空)',
                scenario: options.scenario,
                audience: options.audience,
                tone: options.tone,
              }}
              label="推荐风格"
              onResult={onSuggestStyle}
              disabled={!coreTopic.trim()}
            />
          </div>

          <OptionSelect
            label="视觉风格"
            options={VISUAL_STYLE_OPTIONS}
            value={(options.visual_style ?? 'auto') as JobVisualStyle}
            onChange={(v) =>
              set('visual_style', v === 'auto' ? 'auto' : (v as JobVisualStyle))
            }
          />

          <div>
            <span className="text-xs text-slate-500">图片策略</span>
            <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {IMAGE_STRATEGY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                    options.image_strategy === opt.value
                      ? 'border-gemini-500 bg-gemini-50 dark:bg-gemini-950'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="image_strategy"
                    value={opt.value}
                    checked={options.image_strategy === opt.value}
                    onChange={() => set('image_strategy', opt.value)}
                    className="text-gemini-600"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs text-slate-500">配色</span>
            <div className="mt-1 flex gap-3">
              {COLOR_MODE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="color_mode"
                    value={opt.value}
                    checked={options.color_mode === opt.value}
                    onChange={() => {
                      set('color_mode', opt.value)
                      if (opt.value !== 'brand') set('brand_hex', null)
                      if (opt.value !== 'industry') set('industry', null)
                    }}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            {options.color_mode === 'brand' && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={options.brand_hex ?? ''}
                  onChange={(e) =>
                    set('brand_hex', e.target.value.trim() || null)
                  }
                  placeholder="#003366"
                  className="w-32 rounded-md border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
                />
                <span className="text-xs text-slate-500">HEX 格式 #RRGGBB</span>
              </div>
            )}
            {options.color_mode === 'industry' && (
              <div className="mt-2">
                <OptionSelect
                  label="行业预设"
                  options={INDUSTRY_OPTIONS}
                  value={options.industry ?? 'technology'}
                  onChange={(v) => set('industry', v)}
                />
              </div>
            )}
          </div>

          {/* ── 高级折叠 ────────────────────────────────────── */}
          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              <span>{showAdvanced ? '▾' : '▸'}</span>
              <span>高级（画布 / 模式 / 图标 / 公式 / 备注）</span>
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 rounded-md bg-slate-50 p-3 dark:bg-slate-900">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <OptionSelect
                    label="画布"
                    options={CANVAS_OPTIONS}
                    value={options.canvas}
                    onChange={(v) => set('canvas', v)}
                  />
                  <OptionSelect
                    label="叙事模式"
                    options={MODE_OPTIONS}
                    value={options.mode}
                    onChange={(v) => set('mode', v)}
                  />
                  <OptionSelect
                    label="图标策略"
                    options={ICON_STRATEGY_OPTIONS}
                    value={options.icon_strategy}
                    onChange={(v) => set('icon_strategy', v)}
                  />
                  <OptionSelect
                    label="公式渲染"
                    options={FORMULA_POLICY_OPTIONS}
                    value={options.formula_policy}
                    onChange={(v) => set('formula_policy', v)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-5 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={options.include_speaker_notes}
                      onChange={(e) =>
                        set('include_speaker_notes', e.target.checked)
                      }
                    />
                    <span>生成演讲者备注</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={options.split_mode}
                      onChange={(e) => set('split_mode', e.target.checked)}
                    />
                    <span>长 deck 分阶段模式</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </section>

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
