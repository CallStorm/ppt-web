import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api } from '../api/client'
import type { AdminJob, AdminOverview, AdminUser } from '../api/types'
import { useAuthStore } from '../stores/authStore'
import { confirmDialog } from '../stores/modalStore'
import { PageShell } from '../components/ui/PageShell'
import { Tabs } from '../components/ui/Tabs'
import { notifyError, notifySuccess } from '../stores/toastStore'
import { StatusPill } from '../components/jobs/StatusPill'
import { fmtDateTime } from '../lib/format'

type Tab = 'overview' | 'users' | 'jobs' | 'job-settings' | 'app-settings'

// ── 应用设置：模型配置 ───────────────────────────────────────────
type ModelProvider = 'minimax' | 'deepseek'
type ModelProtocol = 'anthropic'

type ModelEntry = {
  id: string
  name: string
  provider: ModelProvider
  protocol: ModelProtocol
  base_url: string
  model: string
  enabled: boolean
  is_default: boolean
  api_key_set: boolean
}

type ModelDraft = {
  id?: string
  name: string
  provider: ModelProvider
  protocol: ModelProtocol
  base_url: string
  model: string
  enabled: boolean
  is_default: boolean
}

const MODEL_PROVIDERS: ModelProvider[] = ['minimax', 'deepseek']
const MODEL_PROTOCOLS: ModelProtocol[] = ['anthropic']

function newDraftId(): string {
  // 后端 fallback 也是 uuid4 hex；前端预生成以便一次性带上 api key
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
}

const PRESET_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
]
const SECRET_KEYS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']

export function AdminPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(false)

  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [userEdits, setUserEdits] = useState<
    Record<string, { role: string; quota_credits: number; password: string }>
  >({})
  const [jobs, setJobs] = useState<AdminJob[]>([])
  const [jobFilter, setJobFilter] = useState({ status: '', q: '' })

  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)
  const [settingsForm, setSettingsForm] = useState({
    max_concurrent_jobs: 3,
    docker: {} as Record<string, unknown>,
    watchdog: {} as Record<string, unknown>,
    claude_env: {} as Record<string, string>,
    secrets_input: {} as Record<string, string>,
    secrets_clear: {} as Record<string, boolean>,
    custom_env: [] as { key: string; value: string }[],
  })
  const [savingSettings, setSavingSettings] = useState(false)

  // ── 应用设置：模型配置 ──
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null)
  const [modelDraftApiKey, setModelDraftApiKey] = useState('')
  const [appSaving, setAppSaving] = useState(false)

  if (!isAdmin()) return <Navigate to="/" replace />

  const loadOverview = async () => {
    setLoading(true)
    try {
      setOverview(await api<AdminOverview>('GET', '/api/admin/overview'))
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const loadUsers = async () => {
    setLoading(true)
    try {
      const r = await api<{ users: AdminUser[]; total: number }>('GET', '/api/admin/users?limit=100')
      setUsers(r.users)
      const edits: typeof userEdits = {}
      for (const u of r.users) {
        edits[u.id] = { role: u.role, quota_credits: u.quota_credits, password: '' }
      }
      setUserEdits(edits)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const loadJobs = async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ limit: '100' })
      if (jobFilter.status) p.set('status', jobFilter.status)
      if (jobFilter.q) p.set('q', jobFilter.q)
      const r = await api<{ jobs: AdminJob[]; total: number }>('GET', `/api/admin/jobs?${p}`)
      setJobs(r.jobs)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const initSettingsForm = (cfg: Record<string, unknown>) => {
    const claudeEnv = (cfg.claude_env as Record<string, Record<string, string>>) || {}
    const eff = claudeEnv.effective || {}
    const overrides = claudeEnv.overrides || {}
    const claude_env: Record<string, string> = {}
    for (const k of PRESET_ENV_KEYS) {
      claude_env[k] = overrides[k] ?? eff[k] ?? ''
    }
    const custom: { key: string; value: string }[] = []
    for (const [k, v] of Object.entries(overrides)) {
      if (!PRESET_ENV_KEYS.includes(k) && !SECRET_KEYS.includes(k)) {
        custom.push({ key: k, value: String(v) })
      }
    }
    const maxJobs = cfg.max_concurrent_jobs as { effective?: number } | undefined
    const docker = cfg.docker as { effective?: Record<string, unknown> } | undefined
    const watchdog = cfg.watchdog as { effective?: Record<string, unknown> } | undefined
    setSettingsForm({
      max_concurrent_jobs: maxJobs?.effective ?? 3,
      docker: { ...(docker?.effective || {}) },
      watchdog: { ...(watchdog?.effective || {}) },
      claude_env,
      secrets_input: {},
      secrets_clear: {},
      custom_env: custom,
    })
  }

  const loadSettings = async () => {
    setLoading(true)
    try {
      const cfg = await api<Record<string, unknown>>('GET', '/api/admin/settings')
      setSettings(cfg)
      initSettingsForm(cfg)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'overview') loadOverview()
    if (tab === 'users') loadUsers()
    if (tab === 'jobs') loadJobs()
    if (tab === 'job-settings') loadSettings()
    if (tab === 'app-settings') loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const saveUser = async (userId: string) => {
    const ed = userEdits[userId]
    if (!ed) return
    const body: Record<string, unknown> = {
      role: ed.role,
      quota_credits: parseInt(String(ed.quota_credits), 10),
    }
    if (ed.password) body.password = ed.password
    try {
      await api('PATCH', `/api/admin/users/${userId}`, body)
      notifySuccess('用户已更新')
      await loadUsers()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  const cancelJob = async (id: string) => {
    const ok = await confirmDialog({
      title: '取消任务',
      body: `确定取消任务 ${id.slice(0, 8)}…？`,
      confirmText: '取消任务',
    })
    if (!ok) return
    try {
      await api('POST', `/api/admin/jobs/${id}/cancel`)
      notifySuccess('任务已取消')
      await loadJobs()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  const markFailed = async (id: string) => {
    const ok = await confirmDialog({
      title: '标记失败',
      body: '将此任务标记为失败？可选退还 1 credit。',
      confirmText: '标记失败并退款',
    })
    if (!ok) return
    try {
      await api('POST', `/api/admin/jobs/${id}/mark-failed`, {
        reason: 'admin mark failed',
        refund_credit: true,
        cancel_if_running: true,
      })
      notifySuccess('已标记失败')
      await loadJobs()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  const saveSettings = async () => {
    const dockerCfg = (settingsForm.docker || {}) as Record<string, unknown>
    const wdCfg = (settingsForm.watchdog || {}) as Record<string, unknown>
    const wdInterval = Number(wdCfg.interval_s)
    const wdStale = Number(wdCfg.stale_secs)
    const dockerTimeout = Number(dockerCfg.timeout_s)
    if (Number.isFinite(wdInterval) && Number.isFinite(wdStale) && wdInterval >= wdStale) {
      notifyError('watchdog.interval_s 必须小于 stale_secs')
      return
    }
    if (Number.isFinite(dockerTimeout) && (dockerTimeout < 60 || dockerTimeout > 86400)) {
      notifyError('docker.timeout_s 必须在 60..86400 之间')
      return
    }
    if (Number.isFinite(wdStale) && (wdStale < 60 || wdStale > 86400)) {
      notifyError('watchdog.stale_secs 必须在 60..86400 之间')
      return
    }
    if (Number.isFinite(wdInterval) && (wdInterval < 5 || wdInterval > 3600)) {
      notifyError('watchdog.interval_s 必须在 5..3600 之间')
      return
    }
    setSavingSettings(true)
    try {
      const patch: Record<string, unknown> = {
        expected_version: settings?.version,
        max_concurrent_jobs: parseInt(String(settingsForm.max_concurrent_jobs), 10),
        docker: { ...settingsForm.docker },
        watchdog: { ...settingsForm.watchdog },
        claude_env: {},
        secrets: {},
      }
      for (const k of PRESET_ENV_KEYS) {
        const v = settingsForm.claude_env[k]
        if (v !== undefined && v !== '') (patch.claude_env as Record<string, string>)[k] = v
      }
      for (const row of settingsForm.custom_env) {
        if (row.key && row.value !== undefined) {
          (patch.claude_env as Record<string, string>)[row.key] = row.value
        }
      }
      for (const k of SECRET_KEYS) {
        if (settingsForm.secrets_clear[k]) {
          (patch.secrets as Record<string, null>)[k] = null
        } else if (settingsForm.secrets_input[k]) {
          (patch.secrets as Record<string, string>)[k] = settingsForm.secrets_input[k]
        }
      }
      const cfg = await api<Record<string, unknown>>('PATCH', '/api/admin/settings', patch)
      setSettings(cfg)
      initSettingsForm(cfg)
      notifySuccess('设置已保存')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('409')) {
        notifyError('配置已被他人修改，请刷新后重试')
        await loadSettings()
      } else {
        notifyError(msg)
      }
    } finally {
      setSavingSettings(false)
    }
  }

  // ── 应用设置：模型 CRUD ──────────────────────────────────────
  const getModels = (): ModelEntry[] => {
    const app = (settings?.app as { models?: ModelEntry[] } | undefined) || {}
    return Array.isArray(app.models) ? app.models : []
  }

  const startAddModel = () => {
    setModelDraft({
      id: newDraftId(),
      name: '',
      provider: 'minimax',
      protocol: 'anthropic',
      base_url: '',
      model: '',
      enabled: true,
      is_default: getModels().length === 0,
    })
    setModelDraftApiKey('')
  }

  const startEditModel = (m: ModelEntry) => {
    setModelDraft({
      id: m.id,
      name: m.name,
      provider: m.provider,
      protocol: m.protocol,
      base_url: m.base_url,
      model: m.model,
      enabled: m.enabled,
      is_default: m.is_default,
    })
    setModelDraftApiKey('')
  }

  const cancelModelDraft = () => {
    setModelDraft(null)
    setModelDraftApiKey('')
  }

  const _validateDraft = (d: ModelDraft): string | null => {
    if (!d.name.trim()) return '名称必填'
    if (d.name.length > 64) return '名称不能超过 64 字符'
    if (!MODEL_PROVIDERS.includes(d.provider)) return '供应商必须是 minimax / deepseek'
    if (!MODEL_PROTOCOLS.includes(d.protocol)) return '协议必须是 anthropic'
    if (!d.base_url.trim()) return 'Base URL 必填'
    try {
      const u = new URL(d.base_url.trim())
      if (!/^https?:$/.test(u.protocol)) return 'Base URL 必须是 http(s)://'
      if (!u.host) return 'Base URL 缺少 host'
    } catch {
      return 'Base URL 格式错误'
    }
    if (!d.model.trim()) return '模型 ID 必填'
    return null
  }

  const saveModelDraft = async () => {
    if (!modelDraft) return
    const err = _validateDraft(modelDraft)
    if (err) {
      notifyError(err)
      return
    }
    const isNew = !getModels().some((m) => m.id === modelDraft.id)
    const others = getModels().filter((m) => m.id !== modelDraft.id)
    // is_default 互斥
    const fixedDraft: ModelDraft = { ...modelDraft, is_default: !!modelDraft.is_default }
    const newList: ModelEntry[] = [
      ...others.map((m) => ({
        ...m,
        is_default: fixedDraft.is_default ? false : m.is_default,
      })),
      {
        id: fixedDraft.id!,
        name: fixedDraft.name.trim(),
        provider: fixedDraft.provider,
        protocol: fixedDraft.protocol,
        base_url: fixedDraft.base_url.trim(),
        model: fixedDraft.model.trim(),
        enabled: fixedDraft.enabled,
        is_default: fixedDraft.is_default,
        api_key_set: isNew ? false : (getModels().find((m) => m.id === fixedDraft.id)?.api_key_set ?? false),
      },
    ]

    setAppSaving(true)
    try {
      const patch: Record<string, unknown> = {
        expected_version: settings?.version,
        app: {
          models: newList.map((m) => ({
            id: m.id,
            name: m.name,
            provider: m.provider,
            protocol: m.protocol,
            base_url: m.base_url,
            model: m.model,
            enabled: m.enabled,
            is_default: m.is_default,
          })),
        },
      }
      if (modelDraftApiKey.trim()) {
        patch.model_api_keys = { [fixedDraft.id!]: modelDraftApiKey.trim() }
      }
      const cfg = await api<Record<string, unknown>>('PATCH', '/api/admin/settings', patch)
      setSettings(cfg)
      setModelDraft(null)
      setModelDraftApiKey('')
      notifySuccess(isNew ? '模型已新增' : '模型已更新')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('409')) {
        notifyError('配置已被他人修改，请刷新后重试')
        await loadSettings()
      } else {
        notifyError(msg)
      }
    } finally {
      setAppSaving(false)
    }
  }

  const deleteModel = async (m: ModelEntry) => {
    const ok = await confirmDialog({
      title: '删除模型',
      body: `确定删除模型 "${m.name}"？对应 API Key 也会一并清除。`,
      confirmText: '删除',
    })
    if (!ok) return
    const remaining = getModels().filter((x) => x.id !== m.id)
    // 若删的是默认模型，把剩余第一个启用项设为默认
    let next = remaining
    if (m.is_default && remaining.length > 0) {
      const firstEnabled = remaining.find((x) => x.enabled) || remaining[0]
      next = remaining.map((x) => (x.id === firstEnabled.id ? { ...x, is_default: true } : x))
    }
    setAppSaving(true)
    try {
      const patch: Record<string, unknown> = {
        expected_version: settings?.version,
        app: {
          models: next.map((x) => ({
            id: x.id,
            name: x.name,
            provider: x.provider,
            protocol: x.protocol,
            base_url: x.base_url,
            model: x.model,
            enabled: x.enabled,
            is_default: x.is_default,
          })),
        },
        model_api_keys: { [m.id]: null },
      }
      const cfg = await api<Record<string, unknown>>('PATCH', '/api/admin/settings', patch)
      setSettings(cfg)
      notifySuccess('模型已删除')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('409')) {
        notifyError('配置已被他人修改，请刷新后重试')
        await loadSettings()
      } else {
        notifyError(msg)
      }
    } finally {
      setAppSaving(false)
    }
  }

  const toggleModelDefault = async (m: ModelEntry) => {
    if (m.is_default) return  // 已是默认
    const next = getModels().map((x) => ({ ...x, is_default: x.id === m.id }))
    setAppSaving(true)
    try {
      const cfg = await api<Record<string, unknown>>('PATCH', '/api/admin/settings', {
        expected_version: settings?.version,
        app: {
          models: next.map((x) => ({
            id: x.id,
            name: x.name,
            provider: x.provider,
            protocol: x.protocol,
            base_url: x.base_url,
            model: x.model,
            enabled: x.enabled,
            is_default: x.is_default,
          })),
        },
      })
      setSettings(cfg)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setAppSaving(false)
    }
  }

  const toggleModelEnabled = async (m: ModelEntry) => {
    const next = getModels().map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x))
    setAppSaving(true)
    try {
      const cfg = await api<Record<string, unknown>>('PATCH', '/api/admin/settings', {
        expected_version: settings?.version,
        app: {
          models: next.map((x) => ({
            id: x.id,
            name: x.name,
            provider: x.provider,
            protocol: x.protocol,
            base_url: x.base_url,
            model: x.model,
            enabled: x.enabled,
            is_default: x.is_default,
          })),
        },
      })
      setSettings(cfg)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setAppSaving(false)
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'users', label: '用户' },
    { key: 'jobs', label: '任务' },
    { key: 'job-settings', label: 'JOB设置' },
    { key: 'app-settings', label: '应用设置' },
  ]

  return (
    <PageShell width="6xl" title="管理后台">
      <Tabs
        className="mb-4"
        tabs={tabs.map((t) => ({ id: t.key, label: t.label }))}
        active={tab}
        onChange={(id) => setTab(id as typeof tab)}
      />

      {loading && <p className="text-sm text-slate-400">加载中…</p>}

      {tab === 'overview' && overview && (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="用户总数" value={overview.users.total} />
          <Stat label="任务总数" value={overview.jobs.total} />
          <Stat label="运行中" value={overview.jobs.running} />
          <Stat label="排队中" value={overview.jobs.queued} />
        </dl>
      )}

      {tab === 'users' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-2 pr-4">邮箱</th>
                <th className="py-2 pr-4">角色</th>
                <th className="py-2 pr-4">Credits</th>
                <th className="py-2 pr-4">新密码</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">
                    <select
                      value={userEdits[u.id]?.role ?? u.role}
                      onChange={(e) =>
                        setUserEdits((ed) => ({
                          ...ed,
                          [u.id]: { ...ed[u.id], role: e.target.value },
                        }))
                      }
                      className="rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="number"
                      value={userEdits[u.id]?.quota_credits ?? u.quota_credits}
                      onChange={(e) =>
                        setUserEdits((ed) => ({
                          ...ed,
                          [u.id]: { ...ed[u.id], quota_credits: parseInt(e.target.value, 10) },
                        }))
                      }
                      className="w-20 rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="password"
                      placeholder="留空不改"
                      value={userEdits[u.id]?.password ?? ''}
                      onChange={(e) =>
                        setUserEdits((ed) => ({
                          ...ed,
                          [u.id]: { ...ed[u.id], password: e.target.value },
                        }))
                      }
                      className="rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => saveUser(u.id)}
                      className="text-gemini-600 hover:underline"
                    >
                      保存
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'jobs' && (
        <>
          <div className="mb-4 flex gap-2">
            <select
              value={jobFilter.status}
              onChange={(e) => setJobFilter((f) => ({ ...f, status: e.target.value }))}
              className="rounded border px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">全部状态</option>
              <option value="running">running</option>
              <option value="queued">queued</option>
              <option value="done">done</option>
              <option value="failed">failed</option>
            </select>
            <input
              value={jobFilter.q}
              onChange={(e) => setJobFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder="搜索…"
              className="rounded border px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={loadJobs}
              className="rounded bg-slate-100 px-3 py-1 text-sm dark:bg-slate-800"
            >
              搜索
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-2 pr-4">项目</th>
                  <th className="py-2 pr-4">状态</th>
                  <th className="py-2 pr-4">用户</th>
                  <th className="py-2 pr-4">时间</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-4">
                      <Link to={`/jobs/${j.id}`} className="text-gemini-600 hover:underline">
                        {j.project_name || j.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <StatusPill status={j.status} />
                    </td>
                    <td className="py-2 pr-4">{j.user_email || j.user_id?.slice(0, 8)}</td>
                    <td className="py-2 pr-4">{fmtDateTime(j.updated_at)}</td>
                    <td className="py-2 space-x-2">
                      <button type="button" onClick={() => cancelJob(j.id)} className="text-xs text-rose-600">
                        取消
                      </button>
                      <button type="button" onClick={() => markFailed(j.id)} className="text-xs text-amber-600">
                        标记失败
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'job-settings' && settings && (
        <div className="max-w-xl space-y-4">
          {/* ── 帮助卡片：区分两种超时 ─────────────────────────── */}
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="mb-1.5 font-medium">⚠ 这两个超时机制不一样，搞混会出问题</div>
            <p className="mb-1.5">
              <span className="font-semibold">单任务总超时 (docker.timeout_s)</span>
              ：硬性墙钟——从容器启动到结束的绝对时长上限。
              超过即停容器、标 failed、<span className="underline">不退积分</span>（视作取消）。
              修改后仅对<span className="font-semibold">新启动</span>任务生效。
            </p>
            <p>
              <span className="font-semibold">无心跳超时 (watchdog.stale_secs)</span>
              ：心跳式——agent 持续产生事件就不会触发。
              真正卡死（N 秒无任何事件入 DB）才停容器、<span className="underline">自动退 1 积分</span>。
              修改后下一个扫描周期生效。
            </p>
          </div>

          <label className="block">
            <span className="text-xs text-slate-500">最大并发任务数</span>
            <input
              type="number"
              min={1}
              max={50}
              value={settingsForm.max_concurrent_jobs}
              onChange={(e) =>
                setSettingsForm((f) => ({
                  ...f,
                  max_concurrent_jobs: parseInt(e.target.value, 10),
                }))
              }
              className="mt-1 w-full rounded border px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
            />
          </label>

          {/* ── 运行超时分组 ─────────────────────────────────── */}
          <div className="space-y-3 rounded-md border border-slate-200 p-4 dark:border-slate-700">
            <h3 className="text-sm font-medium">运行超时</h3>
            <TimeoutField
              label="单任务总超时"
              fieldPath="docker.timeout_s"
              value={(settingsForm.docker as Record<string, unknown> | undefined)?.timeout_s}
              onChange={(v) =>
                setSettingsForm((f) => ({
                  ...f,
                  docker: { ...(f.docker || {}), timeout_s: v },
                }))
              }
              min={60}
              max={86400}
              unit="秒"
              rangeHint="60–86400"
              defaults={((settings.docker as Record<string, unknown> | undefined)?.defaults as Record<string, unknown> | undefined) || null}
              overrides={((settings.docker as Record<string, unknown> | undefined)?.overrides as Record<string, unknown> | undefined) || null}
              keyName="timeout_s"
            />
          </div>

          {/* ── Watchdog 卡死检测分组 ────────────────────────── */}
          <div className="space-y-3 rounded-md border border-slate-200 p-4 dark:border-slate-700">
            <h3 className="text-sm font-medium">Watchdog 卡死检测</h3>
            <TimeoutField
              label="无心跳超时"
              fieldPath="watchdog.stale_secs"
              value={(settingsForm.watchdog as Record<string, unknown> | undefined)?.stale_secs}
              onChange={(v) =>
                setSettingsForm((f) => ({
                  ...f,
                  watchdog: { ...(f.watchdog || {}), stale_secs: v },
                }))
              }
              min={60}
              max={86400}
              unit="秒"
              rangeHint="60–86400"
              defaults={((settings.watchdog as Record<string, unknown> | undefined)?.defaults as Record<string, unknown> | undefined) || null}
              overrides={((settings.watchdog as Record<string, unknown> | undefined)?.overrides as Record<string, unknown> | undefined) || null}
              keyName="stale_secs"
            />
            <TimeoutField
              label="扫描间隔"
              fieldPath="watchdog.interval_s"
              value={(settingsForm.watchdog as Record<string, unknown> | undefined)?.interval_s}
              onChange={(v) =>
                setSettingsForm((f) => ({
                  ...f,
                  watchdog: { ...(f.watchdog || {}), interval_s: v },
                }))
              }
              min={5}
              max={3600}
              unit="秒"
              rangeHint="5–3600，建议 30–120（过小会增加 DB 负载）"
              defaults={((settings.watchdog as Record<string, unknown> | undefined)?.defaults as Record<string, unknown> | undefined) || null}
              overrides={((settings.watchdog as Record<string, unknown> | undefined)?.overrides as Record<string, unknown> | undefined) || null}
              keyName="interval_s"
            />
          </div>
          {PRESET_ENV_KEYS.map((k) => (
            <label key={k} className="block">
              <span className="text-xs text-slate-500">{k}</span>
              <input
                value={settingsForm.claude_env[k] ?? ''}
                onChange={(e) =>
                  setSettingsForm((f) => ({
                    ...f,
                    claude_env: { ...f.claude_env, [k]: e.target.value },
                  }))
                }
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          ))}
          {SECRET_KEYS.map((k) => (
            <label key={k} className="block">
              <span className="text-xs text-slate-500">{k} (secret)</span>
              <input
                type="password"
                placeholder="留空保持原值"
                value={settingsForm.secrets_input[k] ?? ''}
                onChange={(e) =>
                  setSettingsForm((f) => ({
                    ...f,
                    secrets_input: { ...f.secrets_input, [k]: e.target.value },
                  }))
                }
                className="mt-1 w-full rounded border px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
          ))}
          <button
            type="button"
            disabled={savingSettings}
            onClick={saveSettings}
            className="rounded-md bg-gemini-600 px-4 py-2 text-sm text-white hover:bg-gemini-700 disabled:opacity-50"
          >
            {savingSettings ? '保存中…' : '保存设置'}
          </button>
        </div>
      )}

      {tab === 'app-settings' && settings && (
        <div className="max-w-3xl space-y-4">
          {/* 帮助说明 */}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <strong>模型配置</strong>：用于在页面上直接调用 LLM 做补全 / 重写 / 扩写。
            协议 (Protocol) 决定用哪个 SDK 调用供应商；当前仅 Anthropic 兼容。
            <strong>API Key</strong> 仅保存在后端 secrets，不进入任何容器环境变量。
          </div>

          {/* 列表 */}
          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">名称</th>
                  <th className="px-3 py-2 text-left font-medium">供应商</th>
                  <th className="px-3 py-2 text-left font-medium">模型</th>
                  <th className="px-3 py-2 text-left font-medium">API Key</th>
                  <th className="px-3 py-2 text-center font-medium">启用</th>
                  <th className="px-3 py-2 text-center font-medium">默认</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {getModels().length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-400">
                      尚未配置模型
                    </td>
                  </tr>
                )}
                {getModels().map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2">{m.name}</td>
                    <td className="px-3 py-2 text-slate-500">{m.provider}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{m.model}</td>
                    <td className="px-3 py-2">
                      {m.api_key_set ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          已设置
                        </span>
                      ) : (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                          未设置
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={m.enabled}
                        onChange={() => toggleModelEnabled(m)}
                        disabled={appSaving}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {m.is_default ? (
                        <span className="text-amber-500" title="默认模型">★</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleModelDefault(m)}
                          disabled={appSaving}
                          className="text-xs text-slate-400 hover:text-amber-500"
                        >
                          设为
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => startEditModel(m)}
                        disabled={appSaving}
                        className="mr-3 text-xs text-gemini-600 hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteModel(m)}
                        disabled={appSaving}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 新增 / 编辑 inline form */}
          {modelDraft ? (
            <div className="space-y-3 rounded-md border border-slate-200 p-4 dark:border-slate-700">
              <h3 className="text-sm font-medium">
                {getModels().some((m) => m.id === modelDraft.id) ? '编辑模型' : '新增模型'}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-slate-500">名称 *</span>
                  <input
                    type="text"
                    value={modelDraft.name}
                    onChange={(e) => setModelDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">供应商 *</span>
                  <select
                    value={modelDraft.provider}
                    onChange={(e) =>
                      setModelDraft((d) => (d ? { ...d, provider: e.target.value as ModelProvider } : d))
                    }
                    className="mt-1 w-full rounded border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    {MODEL_PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">协议</span>
                  <select
                    value={modelDraft.protocol}
                    onChange={(e) =>
                      setModelDraft((d) => (d ? { ...d, protocol: e.target.value as ModelProtocol } : d))
                    }
                    className="mt-1 w-full rounded border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    {MODEL_PROTOCOLS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">模型 ID *</span>
                  <input
                    type="text"
                    value={modelDraft.model}
                    onChange={(e) => setModelDraft((d) => (d ? { ...d, model: e.target.value } : d))}
                    placeholder="例如 MiniMax-Text-01"
                    className="mt-1 w-full rounded border px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs text-slate-500">Base URL * (http(s)://)</span>
                  <input
                    type="text"
                    value={modelDraft.base_url}
                    onChange={(e) => setModelDraft((d) => (d ? { ...d, base_url: e.target.value } : d))}
                    placeholder="https://..."
                    className="mt-1 w-full rounded border px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs text-slate-500">API Key (留空 = 保持原值)</span>
                  <input
                    type="password"
                    value={modelDraftApiKey}
                    onChange={(e) => setModelDraftApiKey(e.target.value)}
                    placeholder="留空不修改"
                    className="mt-1 w-full rounded border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </label>
              </div>
              <div className="flex items-center gap-5 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={modelDraft.enabled}
                    onChange={(e) => setModelDraft((d) => (d ? { ...d, enabled: e.target.checked } : d))}
                  />
                  <span>启用</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={modelDraft.is_default}
                    onChange={(e) => setModelDraft((d) => (d ? { ...d, is_default: e.target.checked } : d))}
                  />
                  <span>设为默认</span>
                </label>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={appSaving}
                  onClick={saveModelDraft}
                  className="rounded-md bg-gemini-600 px-4 py-2 text-sm text-white hover:bg-gemini-700 disabled:opacity-50"
                >
                  {appSaving ? '保存中…' : '保存'}
                </button>
                <button
                  type="button"
                  disabled={appSaving}
                  onClick={cancelModelDraft}
                  className="rounded-md bg-slate-100 px-4 py-2 text-sm dark:bg-slate-800"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={startAddModel}
              className="rounded-md border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-gemini-500 hover:text-gemini-600 dark:border-slate-700 dark:text-slate-400"
            >
              + 新增模型
            </button>
          )}
        </div>
      )}
    </PageShell>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  )
}

type TimeoutFieldProps = {
  label: string
  fieldPath: string
  value: unknown
  onChange: (v: number | undefined) => void
  min: number
  max: number
  unit: string
  rangeHint: string
  defaults: Record<string, unknown> | null
  overrides: Record<string, unknown> | null
  keyName: string
}

function TimeoutField({
  label,
  fieldPath,
  value,
  onChange,
  min,
  max,
  unit,
  rangeHint,
  defaults,
  overrides,
  keyName,
}: TimeoutFieldProps) {
  const isCustomized = overrides != null && overrides[keyName] != null
  const defaultVal = defaults?.[keyName]
  const sourceHint = isCustomized
    ? `已自定义 (${String(overrides![keyName])})`
    : defaultVal != null
      ? `默认值 (${String(defaultVal)})`
      : '默认值'

  const display =
    value === undefined || value === null || Number.isNaN(value as number)
      ? ''
      : String(value)

  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-500">
          {label} <span className="text-slate-400">({fieldPath})</span>
        </span>
        <span className="text-[10px] text-slate-400">{sourceHint}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={display}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onChange(undefined)
              return
            }
            const n = parseInt(raw, 10)
            onChange(Number.isFinite(n) ? n : undefined)
          }}
          className="w-32 rounded border px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
        />
        <span className="text-xs text-slate-500">{unit}</span>
      </div>
      <div className="mt-1 text-[10px] text-slate-400">{rangeHint}</div>
    </label>
  )
}
