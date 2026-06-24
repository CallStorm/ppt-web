# 作品卡片与仪表盘体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the jobs dashboard (unified card footer, hover-revealed actions, cover placeholders, loading skeleton, segmented filter, navbar tweaks) and add an in-place retry endpoint for failed/cancelled jobs.

**Architecture:** Frontend changes are pure React/Tailwind in `webui/src` — new small components (`CoverPlaceholder`, `SkeletonCard`, `StatusFilter`) plus rewrites of `JobCard`, `DashboardPage`, `AppShell`. Backend adds one route `POST /jobs/{id}/retry` to `backend/api/routes/jobs.py` that resets the row to `queued` and lets the existing dispatcher + `run_job` path handle it (no runner changes). Retry reuses uploads already on disk; re-charges the owner 1 credit.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (`@apply` in `index.css`), TanStack Query v5, FastAPI + SQLAlchemy, Python.

## Global Constraints

- **No test harness exists in this repo** (no pytest, no vitest). Verification is the repo's existing gates: frontend via `cd webui && npm run build` (which runs `tsc -b && vite build`) and `npm run lint`; backend via reading existing route patterns + manual smoke. **Do not introduce a test framework.** Plan steps use "verify" instead of fabricated test cycles.
- Frontend commands run from `webui/`; backend from repo root.
- Tailwind v4 with `@theme` gemini palette already defined in `webui/src/index.css`. Reuse existing color tokens (`gemini-*`, `slate-*`, `rose-*`, `amber-*`, `blue-*`, `emerald-*`, `violet-*`).
- Status labels and pill CSS classes (`status-pill`, `status-queued` … `status-cancelled`, `status-running-pulse`, `queue-badge`, `pulse-ring`) live in `webui/src/index.css` + `webui/src/lib/format.ts` (`statusLabel`). Do not duplicate.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Commit only the files a task touches. Leave the unrelated working-tree noise (`docker/ppt-runner/*.sh`, `scripts/dev-web.sh`, `ppt-master` submodule) unstaged.
- DRY/YAGNI: extract reusable bits (StatusFilter, CoverPlaceholder) into their own files; do not over-engineer.

**Spec reference:** `docs/superpowers/specs/2026-06-24-job-card-dashboard-polish-design.md`

---

## File Structure

**Frontend (create)**
- `webui/src/components/jobs/CoverPlaceholder.tsx` — generating/failed cover placeholder. One responsibility: render a non-blank thumbnail given a status.
- `webui/src/components/jobs/SkeletonCard.tsx` — loading skeleton card for the dashboard grid.
- `webui/src/components/jobs/StatusFilter.tsx` — capsule segmented control for status filters.

**Frontend (modify)**
- `webui/src/components/jobs/JobCard.tsx` — unified footer + hover overlay + error line + retry entry.
- `webui/src/pages/DashboardPage.tsx` — count into title, StatusFilter, skeleton, drop old count.
- `webui/src/components/layout/AppShell.tsx` — outline admin button, credits icon + spacing.
- `webui/src/hooks/useJobs.ts` — add `useRetryJob`.
- `webui/src/index.css` — cancelled vs queued distinction, running dot, shimmer keyframes.

**Backend (modify)**
- `backend/api/routes/jobs.py` — add `POST /{job_id}/retry`.

---

### Task 1: Backend retry endpoint

**Files:**
- Modify: `backend/api/routes/jobs.py` (add route after `resume_job_endpoint`, ~line 230; imports already present: `shutil`, `User`, `project_root_for`, `notify_dispatcher`, `get_job_or_404`, `require_owner_or_admin`)

**Interfaces:**
- Produces: `POST /api/jobs/{job_id}/retry` → `{ id: str, status: "queued" }`. Owner/admin only. Resets failed/cancelled → queued, re-charges owner 1 credit, wipes project dir, keeps uploads. Task 7's frontend hook calls this exact path.

- [ ] **Step 1: Add the retry route**

Insert this function into `backend/api/routes/jobs.py`, immediately after the `resume_job_endpoint` function (after its `return {"id": job_id, "status": "queued"}` line, before `@router.post("/{job_id}/cancel")`):

```python
@router.post("/{job_id}/retry")
async def retry_job_endpoint(job_id: str, user: CurrentUser) -> dict:
    """原地重试：把 failed/cancelled job 复位成 queued，重新走 run_job（非 resume）。

    - 重新扣 owner 1 credit（admin 触发也由 owner 付）。
    - 清旧产物：rmtree project_root（runner 会重新 mkdir）。
    - 复用上传文件：不动 uploads 目录，dispatcher 的 _collect_upload_paths 会重扫。
    - 绝不用 resume_job——失败任务 session 已死，需全新生成。
    """
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        if j.status not in ("failed", "cancelled"):
            raise HTTPException(
                409, f"job status is {j.status}, can only retry failed/cancelled jobs"
            )
        if not j.user_id:
            raise HTTPException(400, "job has no owner to charge")
        u = s.get(User, j.user_id)
        if not u:
            raise HTTPException(400, "owner user not found")
        if u.quota_credits <= 0:
            raise HTTPException(402, "quota exhausted")
        # 重新计费 + 复位行
        u.quota_credits -= 1
        j.status = "queued"
        j.error_message = None
        j.session_id = None
        j.pptx_path = None
        j.cost_usd = 0
        j.project_dir = None
        j.pending_confirm = None
        s.commit()
        owner_id = j.user_id

    # 清旧产物（runner 重新 mkdir）。uploads 目录不动——复用原上传文件。
    if owner_id:
        proj = project_root_for(owner_id, job_id)
        if proj.exists():
            shutil.rmtree(proj, ignore_errors=True)

    notify_dispatcher()
    return {"id": job_id, "status": "queued"}
```

- [ ] **Step 2: Verify syntax + imports**

Run from repo root:
```bash
python -c "import ast; ast.parse(open('backend/api/routes/jobs.py').read()); print('ok')"
```
Expected: `ok` (no SyntaxError).

Then confirm all names used are already imported (they are: `shutil`, `User`, `SessionLocal`, `HTTPException`, `get_job_or_404`, `require_owner_or_admin`, `project_root_for`, `notify_dispatcher`, `CurrentUser`):
```bash
grep -nE "^from|^import" backend/api/routes/jobs.py | grep -E "shutil|notify_dispatcher|project_root_for|get_job_or_404|require_owner_or_admin|CurrentUser|SessionLocal|^from backend.models"
```
Expected: lines showing each of these imports present (they exist in the current file).

- [ ] **Step 3: Manual smoke (optional, if backend runnable)**

If the dev backend can start, with a failed job `J` and a valid session cookie:
```bash
curl -i -X POST -b cookies.txt http://127.0.0.1:8000/api/jobs/J/retry
```
Expected: `200` with `{"id":"J","status":"queued"}`; job reappears at top of list (updated_at bumped via `onupdate`); uploads dir untouched. If backend isn't runnable in this env, skip — Task 7 will exercise the path via the UI.

- [ ] **Step 4: Commit**

```bash
git add backend/api/routes/jobs.py
git commit -m "$(cat <<'EOF'
feat(jobs): in-place retry endpoint for failed/cancelled jobs

POST /jobs/{id}/retry resets a failed/cancelled job to queued, re-charges
the owner 1 credit, wipes the old project dir, and reuses the uploads
already on disk. Dispatched via the existing run_job path (never resume_job
— a failed job's session is dead).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: CSS — cancelled/queued distinction, running dot, shimmer

**Files:**
- Modify: `webui/src/index.css` (the `@apply` status classes + `@keyframes` block)

**Interfaces:**
- Produces: `.status-cancelled` made more muted than `.status-queued`; a `.status-running-dot` element; `@keyframes shimmer` + `.skeleton-shimmer` utility for `SkeletonCard`. Task 3/4/8 consume these class names.

- [ ] **Step 1: Differentiate cancelled from queued + add running dot**

In `webui/src/index.css`, replace these two lines:

```css
.status-queued { @apply bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300; }
```
and
```css
.status-cancelled { @apply bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400; }
```

with:

```css
.status-queued { @apply bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300; }
.status-cancelled { @apply bg-slate-50 text-slate-400 line-through dark:bg-slate-800/60 dark:text-slate-500; }
```

(Cancelled is now lighter, italic-via-strikethrough, more muted — distinct from queued's solid slate.)

Then, immediately after the `.queue-badge { … }` block, add a running dot helper:

```css
.status-running-dot {
  @apply mr-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500;
  animation: pulse-ring 1.2s ease-in-out infinite;
}
```

- [ ] **Step 2: Add shimmer keyframes for skeleton**

At the end of the file (after `.status-running-pulse { … }`), append:

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton-shimmer {
  background: linear-gradient(90deg, rgb(241 245 249) 25%, rgb(226 232 240) 50%, rgb(241 245 249) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
.dark .skeleton-shimmer {
  background: linear-gradient(90deg, rgb(30 41 59) 25%, rgb(51 65 85) 50%, rgb(30 41 59) 75%);
  background-size: 200% 100%;
}
```

- [ ] **Step 3: Verify build**

```bash
cd webui && npm run build
```
Expected: build succeeds (Tailwind compiles the new `@apply` rules). If a class in `@apply` is invalid, Tailwind errors here — fix the token.

- [ ] **Step 4: Commit**

```bash
git add webui/src/index.css
git commit -m "$(cat <<'EOF'
style(webui): distinct cancelled pill, running dot, skeleton shimmer

Cancelled now reads more muted than queued (lighter bg + strikethrough);
running pill gets a small pulsing dot; add shimmer keyframes for the
upcoming loading skeleton.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: CoverPlaceholder component

**Files:**
- Create: `webui/src/components/jobs/CoverPlaceholder.tsx`

**Interfaces:**
- Consumes: `colorFromId` from `webui/src/lib/format.ts`; `statusLabel` from same; `JobStatus` type from `webui/src/api/types.ts`.
- Produces: default export `CoverPlaceholder({ status, id })` — renders a non-blank gradient thumbnail. Used by `JobCard` (Task 4) when no cover image exists.

- [ ] **Step 1: Create the component**

Create `webui/src/components/jobs/CoverPlaceholder.tsx`:

```tsx
import { colorFromId, statusLabel } from '../../lib/format'
import type { JobStatus } from '../../api/types'

const ACTIVE: JobStatus[] = ['queued', 'running', 'paused']

/**
 * Non-blank cover for jobs without a rendered preview.
 * - queued/running/paused → generating state (pulse + spinner ring)
 * - failed/cancelled → muted failure mark
 * Background reuses the card's identity gradient (colorFromId) for consistency.
 */
export function CoverPlaceholder({ status, id }: { status: JobStatus | string; id: string }) {
  const color = colorFromId(id)
  const gradient = `linear-gradient(135deg, ${color}26, ${color}10)`
  const isActive = ACTIVE.includes(status as JobStatus)

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ background: gradient }}>
      {isActive ? (
        <span className="h-7 w-7 rounded-full border-2 border-slate-400/60 border-t-transparent animate-spin" />
      ) : (
        <span className="text-2xl text-slate-400/70">⚠</span>
      )}
      <span className={`text-xs ${isActive ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400/80'}`}>
        {isActive ? statusLabel(status) : '生成失败'}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd webui && npx tsc -b --noEmit
```
Expected: no errors. (`colorFromId` and `statusLabel` both exist in `format.ts`; `JobStatus` is exported from `api/types.ts`.)

- [ ] **Step 3: Commit**

```bash
git add webui/src/components/jobs/CoverPlaceholder.tsx
git commit -m "$(cat <<'EOF'
feat(webui): CoverPlaceholder for jobs without a rendered preview

Generating (queued/running/paused) shows a spinner ring + status label;
failed/cancelled shows a muted ⚠ + 生成失败. Reuses the card identity
gradient so placeholders stay on-palette.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: JobCard — unified footer + hover overlay + error line + retry

**Files:**
- Modify: `webui/src/components/jobs/JobCard.tsx` (full rewrite of the component body; keep imports minimal)

**Interfaces:**
- Consumes: `useRetryJob` from `webui/src/hooks/useJobs.ts` (added Task 7 — but this task adds the call; if Task 7 not yet done, the hook won't exist, so **Task 7 must be done before or together with this** — see ordering note below); `SlidePreviewModal` (exists); `CoverPlaceholder` (Task 3); `StatusPill`, `QueueBadge` (exist); `Job` type.
- Produces: the polished `JobCard` rendering the unified footer, hover action chip, error line, and retry entry in the more-menu.

> **Ordering note:** This task references `useRetryJob`. Do Task 7 (add the hook) before this task, or do them in one session. The plan lists Task 7 after the visual tasks for narrative flow, but the implementer must add the hook first. To avoid breakage, **Task 7 is sequenced before Task 4 in execution** — i.e., implement Task 7, then Task 4.

- [ ] **Step 1: Add the retry hook first (Task 7 folded in here to satisfy the dependency)**

In `webui/src/hooks/useJobs.ts`, add after `useDeleteJob` (end of file):

```ts
export function useRetryJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; status: string }>('POST', `/api/jobs/${id}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JOBS_KEY })
    },
  })
}
```

- [ ] **Step 2: Rewrite JobCard**

Replace the entire contents of `webui/src/components/jobs/JobCard.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Job } from '../../api/types'
import { downloadUrl } from '../../api/client'
import { StatusPill } from './StatusPill'
import { QueueBadge } from './QueueBadge'
import { CoverPlaceholder } from './CoverPlaceholder'
import { SlidePreviewModal } from './SlidePreviewModal'
import { confirmDialog } from '../../stores/modalStore'
import { useDeleteJob, useRetryJob } from '../../hooks/useJobs'
import { notifyError, notifySuccess } from '../../stores/toastStore'

export function JobCard({ job }: { job: Job }) {
  const hasPptx = !!job.pptx_path
  const isDone = job.status === 'done'
  const showDownload = isDone && hasPptx
  const canRetry = job.status === 'failed' || job.status === 'cancelled'
  const deleteJob = useDeleteJob()
  const retryJob = useRetryJob()
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewOk, setPreviewOk] = useState(!!job.has_preview && isDone)
  const [previewOpen, setPreviewOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Only done jobs (or ones with an explicit preview) attempt an <img>;
  // everything else shows CoverPlaceholder — no broken/white box.
  useEffect(() => {
    setPreviewOk(!!job.has_preview && isDone)
  }, [job.has_preview, job.id, isDone])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDownload = (e: React.MouseEvent) => {
    stop(e)
    if (!hasPptx) return
    downloadUrl(`/api/jobs/${job.id}/pptx`, `${job.project_name || job.id}.pptx`)
  }

  const handlePreview = (e: React.MouseEvent) => {
    stop(e)
    setPreviewOpen(true)
  }

  const handleRetry = async (e: React.MouseEvent) => {
    stop(e)
    setMenuOpen(false)
    // No success toast — the card's own status change (queued→running) is the
    // feedback, per spec §4 (option #1). Only surface failures.
    try {
      await retryJob.mutateAsync(job.id)
    } catch (err) {
      notifyError(err instanceof Error ? err.message : '重试失败')
    }
  }

  const handleMenuToggle = (e: React.MouseEvent) => {
    stop(e)
    setMenuOpen((v) => !v)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    stop(e)
    setMenuOpen(false)
    const ok = await confirmDialog({
      title: '删除作品',
      body: `确认删除「${job.project_name || '(未命名)'}」？此操作不可恢复。`,
      confirmText: '删除',
      cancelText: '取消',
    })
    if (!ok) return
    try {
      await deleteJob.mutateAsync(job.id)
      notifySuccess('作品已删除')
    } catch (err) {
      notifyError(err instanceof Error ? err.message : '删除失败')
    }
  }

  // Failed/cancelled error line (single, truncated).
  const errText =
    job.status === 'cancelled'
      ? '用户取消'
      : job.error_message?.trim()
  const showErr = (job.status === 'failed' || job.status === 'cancelled') && !!errText

  return (
    <article
      className={`group relative rounded-xl border bg-white shadow-sm transition-all
                  hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900
                  ${menuOpen ? 'z-30' : ''}
                  ${job.status === 'running' ? 'border-l-[3px] border-l-gemini-500 border-slate-200 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700'}`}
    >
      <Link to={`/jobs/${job.id}`} className="block">
        <div className="relative aspect-video overflow-hidden rounded-t-xl bg-slate-100 dark:bg-slate-800">
          {previewOk ? (
            <img
              src={`/api/jobs/${job.id}/preview`}
              alt={job.project_name || '封面预览'}
              className="h-full w-full object-cover object-top"
              loading="lazy"
              onError={() => setPreviewOk(false)}
            />
          ) : (
            <CoverPlaceholder status={job.status} id={job.id} />
          )}

          {/* Hover action chip (top-right). Fades in on group-hover. */}
          {(isDone || canRetry) && (
            <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/85 px-1.5 py-1 opacity-0 shadow-sm backdrop-blur transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 dark:bg-slate-900/85">
              {isDone && (
                <button
                  type="button"
                  onClick={handlePreview}
                  className="rounded-full p-1 text-gemini-600 hover:bg-gemini-100 dark:hover:bg-gemini-900/30"
                  title="预览"
                  aria-label="预览"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              )}
              {isDone && showDownload && (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-full p-1 text-gemini-600 hover:bg-gemini-100 dark:hover:bg-gemini-900/30"
                  title="下载 PPTX"
                  aria-label="下载 PPTX"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              )}
              {canRetry && (
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retryJob.isPending}
                  className="rounded-full p-1 text-gemini-600 hover:bg-gemini-100 disabled:opacity-50 dark:hover:bg-gemini-900/30"
                  title="重试"
                  aria-label="重试"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </Link>

      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Link
            to={`/jobs/${job.id}`}
            className="min-w-0 flex-1 truncate text-sm font-medium hover:text-gemini-600"
            title={job.project_name || '(未命名)'}
          >
            {job.project_name || '(未命名)'}
          </Link>

          <div className="flex shrink-0 items-center gap-1">
            <StatusPill status={job.status} />
            <QueueBadge position={job.queue_position} />

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={handleMenuToggle}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                aria-label="更多操作"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 bottom-full z-50 mb-1 min-w-[88px] rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  {canRetry && (
                    <button
                      type="button"
                      onClick={handleRetry}
                      disabled={retryJob.isPending}
                      className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      重试
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleteJob.isPending}
                    className="block w-full px-3 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-900/20"
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {showErr && (
          <p className="mt-1 truncate text-xs text-rose-500/80 dark:text-rose-400/80" title={errText}>
            {errText}
          </p>
        )}
      </div>

      {previewOpen && (
        <SlidePreviewModal
          jobId={job.id}
          jobName={job.project_name || '(未命名)'}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </article>
  )
}
```

- [ ] **Step 3: Verify build + lint**

```bash
cd webui && npm run build && npm run lint
```
Expected: `tsc -b` passes (all referenced imports exist), Vite build succeeds, ESLint clean. If `npm run lint` flags unused imports (e.g. the old `colorFromId` import is gone — good), remove them.

- [ ] **Step 4: Commit (Task 4 + folded Task 7 hook together)**

```bash
git add webui/src/components/jobs/JobCard.tsx webui/src/hooks/useJobs.ts
git commit -m "$(cat <<'EOF'
feat(webui): unified JobCard footer, hover actions, error line, retry

- Footer now always shows StatusPill + more-menu (one layout for every state).
- Cover falls back to CoverPlaceholder instead of a blank box.
- Action chip (preview/download/retry) fades in on hover over the thumbnail.
- Failed/cancelled cards show a one-line truncated error_message.
- More-menu gains 重试 for failed/cancelled; adds useRetryJob hook
  (POST /jobs/{id}/retry → invalidate jobs list).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: StatusPill running dot

**Files:**
- Modify: `webui/src/components/jobs/StatusPill.tsx`

**Interfaces:**
- Consumes: `.status-running-dot` class from Task 2.
- Produces: running pills get a leading pulsing dot.

- [ ] **Step 1: Add the dot for running state**

Replace the whole file `webui/src/components/jobs/StatusPill.tsx` with:

```tsx
import { statusLabel } from '../../lib/format'
import type { JobStatus } from '../../api/types'

const STATUS_CLASS: Record<JobStatus, string> = {
  queued: 'status-queued',
  running: 'status-running',
  paused: 'status-paused',
  done: 'status-done',
  failed: 'status-failed',
  cancelled: 'status-cancelled',
}

export function StatusPill({ status }: { status: JobStatus | string }) {
  const cls = STATUS_CLASS[status as JobStatus] || 'status-queued'
  const isRunning = status === 'running'
  return (
    <span className={`status-pill ${cls}${isRunning ? ' status-running-pulse' : ''}`}>
      {isRunning && <span className="status-running-dot" />}
      {statusLabel(status)}
    </span>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd webui && npm run build
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add webui/src/components/jobs/StatusPill.tsx
git commit -m "$(cat <<'EOF'
style(webui): leading pulsing dot on running status pill

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: SkeletonCard component

**Files:**
- Create: `webui/src/components/jobs/SkeletonCard.tsx`

**Interfaces:**
- Consumes: `.skeleton-shimmer` from Task 2.
- Produces: `SkeletonCard` — a shimmer placeholder matching the card grid cell. Used by `DashboardPage` (Task 8).

- [ ] **Step 1: Create the component**

Create `webui/src/components/jobs/SkeletonCard.tsx`:

```tsx
/** Loading placeholder matching JobCard's grid cell shape. */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="skeleton-shimmer aspect-video rounded-t-xl" />
      <div className="px-3 py-2.5">
        <div className="skeleton-shimmer h-3.5 w-2/3 rounded" />
        <div className="skeleton-shimmer mt-2 h-3 w-1/3 rounded" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd webui && npx tsc -b --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add webui/src/components/jobs/SkeletonCard.tsx
git commit -m "$(cat <<'EOF'
feat(webui): SkeletonCard loading placeholder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: useRetryJob hook

> **Already folded into Task 4 Step 1** (added there to satisfy the dependency before the JobCard rewrite). This task exists only for spec-coverage traceability — **skip the implementation; just confirm the hook is present**.

- [ ] **Step 1: Confirm the hook exists**

```bash
grep -n "useRetryJob" webui/src/hooks/useJobs.ts
```
Expected: a definition line (added in Task 4 Step 1). No new commit.

---

### Task 8: StatusFilter component + DashboardPage integration

**Files:**
- Create: `webui/src/components/jobs/StatusFilter.tsx`
- Modify: `webui/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: `Filter` type (defined in `DashboardPage`, will be lifted/shared).
- Produces: `<StatusFilter value onChange />` capsule control; DashboardPage shows count in title, skeleton on load, no right-side count.

- [ ] **Step 1: Create StatusFilter**

Create `webui/src/components/jobs/StatusFilter.tsx`:

```tsx
export type StatusFilterValue = 'all' | 'running' | 'done' | 'failed'

const OPTIONS: { key: StatusFilterValue; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'done', label: '完成' },
  { key: 'failed', label: '失败' },
]

export function StatusFilter({
  value,
  onChange,
}: {
  value: StatusFilterValue
  onChange: (v: StatusFilterValue) => void
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-full px-3 py-1 text-xs transition-colors ${
            value === o.key
              ? 'bg-gemini-600 text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite DashboardPage**

Replace the entire contents of `webui/src/pages/DashboardPage.tsx` with:

```tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { JobCard } from '../components/jobs/JobCard'
import { SkeletonCard } from '../components/jobs/SkeletonCard'
import { StatusFilter, type StatusFilterValue } from '../components/jobs/StatusFilter'
import { useJobs } from '../hooks/useJobs'
import type { Job } from '../api/types'

type Filter = StatusFilterValue

function matchesFilter(job: Job, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'running') return job.status === 'running' || job.status === 'queued' || job.status === 'paused'
  if (filter === 'done') return job.status === 'done'
  if (filter === 'failed') return job.status === 'failed' || job.status === 'cancelled'
  return true
}

export function DashboardPage() {
  const { data: jobs = [], isLoading } = useJobs()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return jobs.filter((j) => {
      if (!matchesFilter(j, filter)) return false
      if (!q) return true
      return (
        (j.project_name || '').toLowerCase().includes(q) ||
        (j.prompt || '').toLowerCase().includes(q)
      )
    })
  }, [jobs, filter, query])

  const reduced = filtered.length !== jobs.length

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            我的作品
            <span className="ml-2 text-sm font-normal text-slate-400">
              ({reduced ? `${filtered.length}/${jobs.length}` : jobs.length})
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索作品…"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-gemini-500 focus:outline-none sm:w-56 dark:border-slate-700 dark:bg-slate-800"
          />
          <StatusFilter value={filter} onChange={setFilter} />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-slate-400">
            {jobs.length === 0 ? '还没有作品' : '没有匹配的作品'}
          </p>
          {jobs.length === 0 && (
            <Link
              to="/jobs/new"
              className="mt-4 rounded-md bg-gemini-600 px-4 py-2 text-sm font-medium text-white hover:bg-gemini-700"
            >
              创建
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify build + lint**

```bash
cd webui && npm run build && npm run lint
```
Expected: succeeds. The old `filters` array literal and right-side `11/11` span are gone; `StatusFilter` imported and used.

- [ ] **Step 4: Commit**

```bash
git add webui/src/components/jobs/StatusFilter.tsx webui/src/pages/DashboardPage.tsx
git commit -m "$(cat <<'EOF'
feat(webui): segmented status filter, count in title, loading skeleton

- Status filter becomes a capsule segmented control (larger hit area).
- Count moves into the title: 我的作品 (N), or (shown/total) when filtered.
- Loading state shows 6 SkeletonCards instead of plain text.
- Drops the redundant 共 N 个作品 subtitle and right-side count.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: AppShell — outline admin button, credits icon + spacing

**Files:**
- Modify: `webui/src/components/layout/AppShell.tsx`

**Interfaces:**
- None new.

- [ ] **Step 1: Demote admin button + add credits icon + spacing**

In `webui/src/components/layout/AppShell.tsx`, replace the admin `<Link>` (the `isAdmin()` block) — change its className from the amber-filled style to an outline style:

old:
```tsx
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
```
new:
```tsx
              className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
```

Then in the right cluster, change the wrapper `gap-3` to `gap-4`:

old:
```tsx
        <div className="ml-auto flex items-center gap-3 text-sm">
```
new:
```tsx
        <div className="ml-auto flex items-center gap-4 text-sm">
```

And replace the credits capsule to add a ◆ glyph before the number:

old:
```tsx
          <span className="rounded-full bg-gemini-50 px-2 py-0.5 text-xs font-medium text-gemini-700 dark:bg-gemini-900/30 dark:text-gemini-200">
            {me?.quota_credits ?? 0} credits
          </span>
```
new:
```tsx
          <span className="inline-flex items-center gap-1 rounded-full bg-gemini-50 px-2 py-0.5 text-xs font-medium text-gemini-700 dark:bg-gemini-900/30 dark:text-gemini-200">
            <span aria-hidden>◆</span>
            {me?.quota_credits ?? 0} credits
          </span>
```

- [ ] **Step 2: Verify build + lint**

```bash
cd webui && npm run build && npm run lint
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add webui/src/components/layout/AppShell.tsx
git commit -m "$(cat <<'EOF'
style(webui): outline admin button, credits icon, navbar spacing

管理后台 demoted from amber-filled to a neutral outline so it no longer
fights the blue 创建 button; credits capsule gains a ◆ glyph and the
right cluster widens to gap-4 for breathing room.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Final full verification

**Files:**
- None (verification only).

- [ ] **Step 1: Full frontend build + lint**

```bash
cd webui && npm run build && npm run lint
```
Expected: both succeed with no errors.

- [ ] **Step 2: Backend import sanity**

```bash
python -c "import ast; ast.parse(open('backend/api/routes/jobs.py').read()); print('backend ok')"
```
Expected: `backend ok`.

- [ ] **Step 3: Manual UI smoke (if dev servers runnable)**

Start the webui dev server and, in the browser:
- Dashboard loads with skeleton cards, then real cards.
- A `done` card: status pill "完成" in footer; hovering the thumbnail shows preview/download chip; clicking preview opens the modal.
- A `running` card: blue pill with pulsing dot + leading dot; no hover chip; CoverPlaceholder spinner.
- A `failed` card: red pill + one-line error under title; hover chip shows ↻ retry; more-menu has 重试 + 删除. Click retry → card flips to queued/running, floats to top, toast "已重新加入队列".
- Filter segmented control switches sets; title count updates to `(shown/total)`.
- Navbar: 管理后台 is outline; credits shows ◆ N credits; right side no longer cramped.

- [ ] **Step 4: Final commit (only if any stray fixes were made)**

If Steps 1–3 needed fixes, commit them. Otherwise nothing to commit — done.
