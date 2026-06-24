# 错误信息友好化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate raw machine error strings (e.g. `stop_reason=stop_sequence`) stored in `Job.error_message` into friendly Chinese, so the job card's error line reads like "AI 生成中断，请重试" instead of jargon.

**Architecture:** One pure backend helper `humanize_error(raw) -> str|None` in a new `backend/runner/errors.py`, applied at the 5 places that set failure `error_message` (sync.py, dispatcher.py, watchdog.py, init.py, docker.py). Known jargon patterns → friendly text; unknown strings pass through unchanged; the raw string is logged with job_id context. No schema change, no frontend change.

**Tech Stack:** Python, FastAPI/SQLAlchemy backend. No test framework in repo.

## Global Constraints

- **No test framework** (no pytest). Verification = `python -c "import ast; ast.parse(...)"` syntax check + a `python -c` sanity check of `humanize_error` against each pattern. Do NOT introduce pytest.
- Backend commands run from repo root (`\\wsl.localhost\Ubuntu\home\dministrator\ppt-web`). The repo lives in WSL at `/home/dministrator/ppt-web`; run python via `wsl bash -lc 'cd /home/dministrator/ppt-web && ...'` if Windows python has encoding/locale issues.
- `humanize_error` is **idempotent**: friendly outputs don't match any pattern → pass through. Re-wrapping an already-friendly value is a safe no-op.
- `humanize_error` is a **pure function**: no logging inside it. Logging of the raw string happens at the call site (where `job_id` is available).
- Mapping order is **sensitive**: `auto-resume claude CLI 失败` must precede `claude CLI 失败` (prefix relationship).
- Unknown / unrecognized strings pass through **unchanged** (no generic fallback) — this is the spec's decision #3.
- Pass through unchanged (do NOT translate): `"user cancelled"`, `"admin cancelled"`, admin-supplied `body.reason` free text.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Commit only the files a task touches. Leave unrelated working-tree noise (docker `.sh` exec-bit changes, `ppt-master` submodule, pre-existing lint errors in webui files) unstaged.

**Spec reference:** `docs/superpowers/specs/2026-06-24-error-humanize-design.md`

---

## File Structure

**Create**
- `backend/runner/errors.py` — pure `humanize_error(raw)`. One responsibility: map raw error string → friendly text.

**Modify**
- `backend/runner/sync.py` — wrap `error_message` in both `final` dicts (run_sync + resume_sync) and the two exception-path return dicts; log raw with job_id.
- `backend/runtime/dispatcher.py` — wrap `docker_err` and the two `* exception: {e}` strings; log raw.
- `backend/runtime/watchdog.py` — wrap the `watchdog:` string; log raw.
- `backend/runtime/init.py` — wrap the `server restart interrupted` string; log raw.
- `backend/runner/docker.py` — humanize the returned error string inside `check_docker_runner_ready`; log raw.

---

### Task 1: `humanize_error` helper

**Files:**
- Create: `backend/runner/errors.py`

**Interfaces:**
- Produces: `humanize_error(raw: str | None) -> str | None`. Returns `None` for `None`/empty; friendly Chinese for known patterns; the input unchanged for unknown strings. Task 2 consumes this at 5 call sites.

- [ ] **Step 1: Create the helper**

Create `backend/runner/errors.py`:

```python
"""把对用户不友好的机器错误串翻译为友好中文。

纯函数，无 I/O、无日志。未知串原样透传（不吞错误）。对友好化后的串
幂等——友好输出不命中任何模式 → 原样返回。
"""
from __future__ import annotations

# 顺序敏感：更具体的前缀在前（auto-resume claude CLI 失败 是 claude CLI 失败 的前缀）。
_PREFIX_MAP: list[tuple[str, str]] = [
    ("auto-resume bailed", "AI 未生成有效内容，请调整需求后重试"),
    ("auto-resume claude CLI 失败", "AI 服务调用失败，请稍后重试"),
    ("claude CLI 失败", "AI 服务调用失败，请稍后重试"),
    ("stop_reason=", "AI 生成中断，请重试"),
    ("runner exception:", "生成过程异常，请重试"),
    ("resume exception:", "生成过程异常，请重试"),
    ("watchdog:", "生成超时未响应，请重试"),
    ("server restart interrupted", "服务重启中断了任务，请重试"),
]

# docker 错误（check_docker_runner_ready 返回的几种），大小写不敏感匹配。
_DOCKER_SUBSTRINGS: tuple[str, ...] = (
    "docker daemon is not available",
    "docker cli not found",
    "docker info timed out",
    "docker info failed",
    "docker image inspect failed",
)
_DOCKER_FRIENDLY = "运行环境未就绪，请联系管理员"


def humanize_error(raw: str | None) -> str | None:
    """raw → 友好文案。None/空 → None；已知模式 → 友好中文；未知 → 原样返回。"""
    if not raw:
        return raw  # None 或 ""
    for prefix, friendly in _PREFIX_MAP:
        if raw.startswith(prefix):
            return friendly
    low = raw.lower()
    if any(s in low for s in _DOCKER_SUBSTRINGS):
        return _DOCKER_FRIENDLY
    return raw
```

- [ ] **Step 2: Verify syntax**

Run (from repo root, via WSL if Windows python has locale issues):
```bash
python -c "import ast; ast.parse(open('backend/runner/errors.py',encoding='utf-8').read()); print('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Sanity-check the mapping**

Run:
```bash
python -c "
from backend.runner.errors import humanize_error as h
assert h(None) is None
assert h('') == ''
assert h('stop_reason=stop_sequence') == 'AI 生成中断，请重试'
assert h('stop_reason=max_tokens') == 'AI 生成中断，请重试'
assert h('auto-resume bailed: no file changes after multiple rounds; agent likely hallucinated') == 'AI 未生成有效内容，请调整需求后重试'
assert h('claude CLI 失败: timeout') == 'AI 服务调用失败，请稍后重试'
assert h('auto-resume claude CLI 失败: x') == 'AI 服务调用失败，请稍后重试'
assert h('runner exception: KeyError') == '生成过程异常，请重试'
assert h('resume exception: ValueError') == '生成过程异常，请重试'
assert h('watchdog: no event for 300s; stopped container=yes') == '生成超时未响应，请重试'
assert h('server restart interrupted your previous run') == '服务重启中断了任务，请重试'
assert h('Docker daemon is not available (docker info failed)') == '运行环境未就绪，请联系管理员'
assert h('docker CLI not found; install Docker and ensure it is on PATH') == '运行环境未就绪，请联系管理员'
# idempotency
assert h('AI 生成中断，请重试') == 'AI 生成中断，请重试'
# unknown passes through
assert h('something totally unexpected') == 'something totally unexpected'
assert h('user cancelled') == 'user cancelled'
print('all assertions passed')
"
```
Expected: `all assertions passed`. (Run from repo root so `backend.runner.errors` imports; set `PYTHONPATH=.` if needed, i.e. `PYTHONPATH=. python -c "..."`.)

- [ ] **Step 4: Commit**

```bash
git add backend/runner/errors.py
git commit -m "$(cat <<'EOF'
feat(runner): humanize_error helper for friendly error messages

Pure mapping from raw machine error strings (stop_reason=*, auto-resume
bailed, claude CLI 失败, * exception:, watchdog:, server restart,
docker) to friendly Chinese. Unknown strings pass through unchanged;
idempotent on already-friendly output.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire humanize_error into the 5 failure paths

**Files:**
- Modify: `backend/runner/sync.py` (run_sync + resume_sync `final` dicts, both exception-path return dicts)
- Modify: `backend/runtime/dispatcher.py` (docker_err ×2, runner/resume exception ×2)
- Modify: `backend/runtime/watchdog.py` (watchdog string)
- Modify: `backend/runtime/init.py` (server restart string)
- Modify: `backend/runner/docker.py` (check_docker_runner_ready return)

**Interfaces:**
- Consumes: `humanize_error` from `backend/runner/errors.py` (Task 1).
- Produces: friendly `Job.error_message` everywhere failures are recorded. No new public API.

**Important context for the implementer:**
- `humanize_error` is idempotent, so wrapping an already-friendly value (e.g. dispatcher's `final.get("error_message")` which came from sync.py) is a safe no-op — but the spec says do NOT wrap those pass-through lines (220, 324 in dispatcher.py); only wrap the freshly-generated raw strings.
- Log the **raw** string at each call site with `job_id` where available, THEN store the humanized value.
- Do NOT touch: `backend/api/routes/jobs.py:288` (`"user cancelled"`), `backend/runtime/jobs.py:73` (`"user cancelled"`), `backend/admin/router.py` cancel + `body.reason` lines.

- [ ] **Step 1: sync.py — import + wrap run_sync final + its exception path**

In `backend/runner/sync.py`, add the import after the existing `from backend.runner.stages import ...` line (line 12):

```python
from backend.runner.errors import humanize_error
```

In `run_sync`, the `final` dict (around line 192) currently builds `error_message` inline. Replace the `error_message` line in that dict. Find:

```python
        "error_message": (
            None if status != "failed" else
            ("auto-resume bailed: no file changes after multiple rounds; agent likely hallucinated"
             if no_progress_bail else f"stop_reason={stop_reason}")
        ),
```

Replace with (compute raw, log it, humanize):

```python
        "error_message": _humanize_run_error(
            None if status != "failed" else
            ("auto-resume bailed: no file changes after multiple rounds; agent likely hallucinated"
             if no_progress_bail else f"stop_reason={stop_reason}"),
            job_id,
        ),
```

Then add this module-level helper near the top of the file (after the `log = logging.getLogger(...)` line, line 14):

```python
def _humanize_run_error(raw: str | None, job_id: str | None) -> str | None:
    """Log the raw error with job_id, return the humanized version."""
    if raw:
        log.warning("job %s failed raw error: %s", job_id, raw)
    return humanize_error(raw)
```

- [ ] **Step 2: sync.py — wrap the run_sync exception-path return**

In `run_sync`'s `except Exception as e:` block (the one that returns a failed dict with `"error_message": str(e)` — around line 139, the auto-resume inner exception, AND the outer exception). There are two exception return dicts in run_sync's auto-resume loop region and one in resume_sync. For each return dict that sets `"error_message": str(e)` or `"error_message": f"..."`, wrap via `_humanize_run_error`.

Specifically, find each occurrence of:
```python
            "error_message": str(e),
```
within `sync.py` and replace with:
```python
            "error_message": _humanize_run_error(str(e), job_id),
```

And find (the auto-resume claude CLI 失败 path, which currently sets a plain `str(e)` — confirm by reading; if it instead uses a literal `f"auto-resume claude CLI 失败: {e}"` it is already covered by the helper's prefix match once wrapped). For any return dict whose `error_message` is a raw `str(e)` or an `f"..."`, wrap it with `_humanize_run_error(<that expr>, job_id)`.

Read `backend/runner/sync.py` fully first to enumerate every return dict with a non-None `error_message` in both `run_sync` and `resume_sync`, and wrap each. Do not change `status`, `session_id`, or other fields.

- [ ] **Step 3: sync.py — wrap resume_sync final**

In `resume_sync`, the `final` dict (around line 280) has:
```python
        "error_message": None if status != "failed" else f"stop_reason={stop_reason}",
```
Replace with:
```python
        "error_message": _humanize_run_error(
            None if status != "failed" else f"stop_reason={stop_reason}", job_id,
        ),
```

- [ ] **Step 4: Verify sync.py syntax**

```bash
python -c "import ast; ast.parse(open('backend/runner/sync.py',encoding='utf-8').read()); print('ok')"
```
Expected: `ok`.

- [ ] **Step 5: dispatcher.py — wrap docker_err and the two exception strings**

In `backend/runtime/dispatcher.py`, add the import. Find the existing import block (lines 8-20) and add:

```python
from backend.runner.errors import humanize_error
```

There are two `docker_err = check_docker_runner_ready()` blocks (run_job ~line 160, resume_job ~line 283), each followed by `j.error_message = docker_err`. For each, change the assignment to log + humanize. Find (run_job, ~line 166):

```python
                j.error_message = docker_err
```
Replace with:
```python
                log.warning("job %s docker not ready raw: %s", job_id, docker_err)
                j.error_message = humanize_error(docker_err)
```

Find (resume_job, ~line 289):
```python
                j.error_message = docker_err
```
Replace with:
```python
                log.warning("job %s docker not ready raw: %s", job_id, docker_err)
                j.error_message = humanize_error(docker_err)
```

The two runner/resume exception assignments (~lines 237, 334):
```python
                j.error_message = f"runner exception: {e}"
```
Replace with:
```python
                log.warning("job %s runner exception raw: %s", job_id, e)
                j.error_message = humanize_error(f"runner exception: {e}")
```
and:
```python
                j.error_message = f"resume exception: {e}"
```
Replace with:
```python
                log.warning("job %s resume exception raw: %s", job_id, e)
                j.error_message = humanize_error(f"resume exception: {e}")
```

Do NOT touch the `j.error_message = final.get("error_message")` lines (~220, 324) — those carry already-humanized values from sync.py.

- [ ] **Step 6: Verify dispatcher.py syntax**

```bash
python -c "import ast; ast.parse(open('backend/runtime/dispatcher.py',encoding='utf-8').read()); print('ok')"
```
Expected: `ok`.

- [ ] **Step 7: watchdog.py — wrap the watchdog string**

In `backend/runtime/watchdog.py`, add import near the top (after existing imports):
```python
from backend.runner.errors import humanize_error
```

Find (~line 67):
```python
            j.error_message = (
                f"watchdog: no event for {threshold_seconds}s; "
                f"stopped container={'yes' if stopped else 'no'}"
            )
```
Replace with (log raw, store humanized):
```python
            raw = (
                f"watchdog: no event for {threshold_seconds}s; "
                f"stopped container={'yes' if stopped else 'no'}"
            )
            log.warning("job %s watchdog raw: %s", j.id, raw)
            j.error_message = humanize_error(raw)
```
(`log` is already defined in watchdog.py — confirm by reading its top; if not, use the existing module logger name.)

- [ ] **Step 8: init.py — wrap the server restart string**

In `backend/runtime/init.py`, add import near the top:
```python
from backend.runner.errors import humanize_error
```

Find (~line 27):
```python
            j.error_message = "server restart interrupted your previous run"
```
Replace with:
```python
            log.warning("job %s restart-interrupt raw: server restart interrupted", j.id)
            j.error_message = humanize_error("server restart interrupted your previous run")
```
(Confirm `log` exists in init.py; if the module uses a different logger name, use it. If no logger is imported, add `import logging` + `log = logging.getLogger("backend.runtime.init")` at top, or reuse whatever the file already uses.)

- [ ] **Step 9: docker.py — humanize inside check_docker_runner_ready**

In `backend/runner/docker.py`, add import near the top:
```python
from backend.runner.errors import humanize_error
```

`check_docker_runner_ready` returns raw error strings like `"Docker daemon is not available (docker info failed)"`, `"docker CLI not found; install Docker and ensure it is on PATH"`, etc. Wrap each return so the caller gets the friendly text. The cleanest minimal change: at the end of the function, before each `return "<error>"`, log + return humanized. 

Read `check_docker_runner_ready` (lines ~39-75). It has several `return "<raw error>"` statements. For each, replace `return "<raw>"` with:
```python
            raw = "<raw>"
            log.warning("docker runner not ready: %s", raw)
            return humanize_error(raw)
```
Because all docker raw strings contain a `_DOCKER_SUBSTRINGS` token, `humanize_error` maps them all to `"运行环境未就绪，请联系管理员"`. Apply this to every error `return` in the function (the success path `return None` stays unchanged).

If the file has no module logger, add `import logging` and `log = logging.getLogger("backend.runner.docker")` at the top.

- [ ] **Step 10: Verify all modified files parse**

```bash
for f in backend/runner/sync.py backend/runtime/dispatcher.py backend/runtime/watchdog.py backend/runtime/init.py backend/runner/docker.py; do python -c "import ast; ast.parse(open('$f',encoding='utf-8').read())" && echo "$f ok"; done
```
Expected: each file prints `<path> ok`.

- [ ] **Step 11: Import sanity (no circular imports)**

```bash
python -c "import backend.runner.sync, backend.runtime.dispatcher, backend.runtime.watchdog, backend.runtime.init, backend.runner.docker, backend.runner.errors; print('imports ok')"
```
Expected: `imports ok`. (Run from repo root with `PYTHONPATH=.` if needed.) If a circular import error appears, `errors.py` must not import anything from `backend.runner`/`backend.runtime` — confirm it imports nothing (it shouldn't).

- [ ] **Step 12: Commit**

```bash
git add backend/runner/sync.py backend/runtime/dispatcher.py backend/runtime/watchdog.py backend/runtime/init.py backend/runner/docker.py
git commit -m "$(cat <<'EOF'
feat(runner): wire humanize_error into failure paths

Apply humanize_error at every site that records a failure error_message
(sync.py run/resume + exceptions, dispatcher docker_err and runner/resume
exceptions, watchdog, init restart-interrupt, docker runner-ready checks).
The raw string is logged with job_id; the stored error_message is now
friendly Chinese. Unknown errors pass through unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Final verification

**Files:** None (verification only).

- [ ] **Step 1: Full backend syntax + import sweep**

```bash
for f in backend/runner/errors.py backend/runner/sync.py backend/runtime/dispatcher.py backend/runtime/watchdog.py backend/runtime/init.py backend/runner/docker.py; do python -c "import ast; ast.parse(open('$f',encoding='utf-8').read())" && echo "$f ok"; done
python -c "import backend.runner.sync, backend.runtime.dispatcher, backend.runtime.watchdog, backend.runtime.init, backend.runner.docker, backend.runner.errors; print('imports ok')"
```
Expected: all files `ok` + `imports ok`.

- [ ] **Step 2: Re-run the humanize_error sanity check**

```bash
PYTHONPATH=. python -c "
from backend.runner.errors import humanize_error as h
assert h('stop_reason=stop_sequence') == 'AI 生成中断，请重试'
assert h('auto-resume bailed: x') == 'AI 未生成有效内容，请调整需求后重试'
assert h('runner exception: K') == '生成过程异常，请重试'
assert h('watchdog: z') == '生成超时未响应，请重试'
assert h('Docker daemon is not available') == '运行环境未就绪，请联系管理员'
assert h('unknown xyz') == 'unknown xyz'
assert h('user cancelled') == 'user cancelled'
print('ok')
"
```
Expected: `ok`.

- [ ] **Step 3: Manual smoke (optional, if backend runnable)**

If the dev backend can start: trigger a failed job (or set an existing failed job's `error_message` to `stop_reason=stop_sequence` and re-run a retry that fails), confirm the card/detail page now shows "AI 生成中断，请重试" and the server log contains the raw `stop_reason=stop_sequence` with the job_id. If backend isn't runnable, skip — the helper sanity check + import sweep cover correctness.

- [ ] **Step 4: Final commit (only if stray fixes were made)**

If Steps 1–2 needed fixes, commit them. Otherwise nothing to commit — done.
