import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api } from '../api/client'
import type { AdminJob, AdminOverview, AdminUser } from '../api/types'
import { useAuthStore } from '../stores/authStore'
import { confirmDialog } from '../stores/modalStore'
import { notifyError, notifySuccess } from '../stores/toastStore'
import { StatusPill } from '../components/jobs/StatusPill'
import { fmtDateTime } from '../lib/format'

type Tab = 'overview' | 'users' | 'jobs' | 'settings'

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
    if (tab === 'settings') loadSettings()
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'users', label: '用户' },
    { key: 'jobs', label: '任务' },
    { key: 'settings', label: '设置' },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-xl font-semibold">管理后台</h1>

      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm ${
              tab === t.key
                ? 'border-b-2 border-gemini-600 font-medium text-gemini-600'
                : 'text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

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

      {tab === 'settings' && settings && (
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
    </div>
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
