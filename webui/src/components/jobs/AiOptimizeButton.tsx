import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { notifyError } from '../../stores/toastStore'

export type ModelInfo = {
  configured: boolean
  code?: string
  message?: string
  id?: string
  name?: string
  provider?: string
  model?: string
}

type AiOptimizeButtonProps = {
  /** 后端端点路径（不含前缀），如 'optimize-prompt' */
  endpoint:
    | 'optimize-prompt'
    | 'generate-outline'
    | 'suggest-style'
  /** 请求体 */
  body: Record<string, unknown>
  /** 按钮文本 */
  label: string
  /** 成功后调用，把解析后的 JSON 传出去 */
  onResult: (data: Record<string, unknown>, model: ModelInfo) => void
  /** 整体禁用 */
  disabled?: boolean
  /** 自定义 className */
  className?: string
}

// 模块级缓存：default model info 在一次会话内不会变，只拉一次
let _modelInfoCache: ModelInfo | null = null
let _modelInfoPromise: Promise<ModelInfo> | null = null

async function fetchDefaultModel(): Promise<ModelInfo> {
  if (_modelInfoCache) return _modelInfoCache
  if (_modelInfoPromise) return _modelInfoPromise
  _modelInfoPromise = (async () => {
    try {
      const m = await api<ModelInfo>('GET', '/api/app/llm/default-model')
      _modelInfoCache = m
      return m
    } catch {
      _modelInfoPromise = null
      return { configured: false, code: 'fetch_error', message: 'fetch failed' }
    } finally {
      _modelInfoPromise = null
    }
  })()
  return _modelInfoPromise
}

export async function getDefaultModelInfo(): Promise<ModelInfo> {
  return fetchDefaultModel()
}

export function invalidateDefaultModelCache() {
  _modelInfoCache = null
  _modelInfoPromise = null
}

export function AiOptimizeButton({
  endpoint,
  body,
  label,
  onResult,
  disabled,
  className = '',
}: AiOptimizeButtonProps) {
  const [model, setModel] = useState<ModelInfo | null>(_modelInfoCache)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (_modelInfoCache) {
      setModel(_modelInfoCache)
      return
    }
    let alive = true
    fetchDefaultModel().then((m) => {
      if (alive) setModel(m)
    })
    return () => {
      alive = false
    }
  }, [])

  const onClick = async () => {
    if (loading || disabled) return
    setLoading(true)
    try {
      // 端点拉一次最新 model info（避免缓存过期）
      const m = await fetchDefaultModel()
      if (!m.configured) {
        notifyError(
          m.message || '未配置默认模型，请到 管理后台 → 应用设置 配置',
        )
        return
      }
      const resp = (await api('POST', `/api/app/llm/${endpoint}`, body)) as Record<string, unknown>
      const modelUsed = (resp.model_used as ModelInfo | undefined) ?? m
      onResult(resp, modelUsed)
      notifySuccess(`AI 优化完成（${modelUsed.name ?? '模型'}）`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 解析后端 detail JSON（如 {"code":"no_api_key","message":"..."}）
      const match = msg.match(/\d+:\s*({.*})/s)
      if (match) {
        try {
          const detail = JSON.parse(match[1])
          notifyError(`AI 失败：${detail.message ?? msg}`)
          return
        } catch {
          /* fall through */
        }
      }
      notifyError(`AI 失败：${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const tag =
    model?.configured && model.name
      ? `当前模型：${model.name}`
      : '未配置模型'

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        className="rounded-md border border-gemini-300 bg-gemini-50 px-2.5 py-1 text-xs text-gemini-700 hover:bg-gemini-100 disabled:opacity-50 dark:border-gemini-700 dark:bg-gemini-950 dark:text-gemini-200 dark:hover:bg-gemini-900"
      >
        {loading ? '运行中…' : `✨ ${label}`}
      </button>
      <span
        className={`text-[10px] ${model?.configured ? 'text-slate-400' : 'text-amber-600 dark:text-amber-400'}`}
      >
        {tag}
      </span>
    </div>
  )
}
