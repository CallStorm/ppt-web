#!/usr/bin/env python3
"""Split backend/_core_original.py into runner/ and runtime/ modules."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "backend" / "_core_original.py").read_text()

# Shared header for runner modules
RUNNER_HEADER = '''from __future__ import annotations

'''

STATE = '''"""Runtime global mutable state."""
from __future__ import annotations

import asyncio
import threading

_watchdog_task: asyncio.Task | None = None
_active_job_ids: set[str] = set()
_active_proc_holders: dict[str, list] = {}
_active_cancel_events: dict[str, threading.Event] = {}
_subscribers: dict[str, list[asyncio.Queue]] = {}
_seq_counters: dict[str, int] = {}
_seq_locks: dict[str, threading.Lock] = {}
_dispatcher_task: asyncio.Task | None = None
_dispatcher_event: asyncio.Event | None = None
'''

(ROOT / "backend/runtime/state.py").write_text(STATE)

# Use line-based extraction from original
lines = SRC.splitlines(keepends=True)

def extract(start_marker: str, end_marker: str | None = None) -> str:
    start = None
    end = len(lines)
    for i, line in enumerate(lines):
        if start_marker in line and start is None:
            start = i
        elif end_marker and start is not None and end_marker in line and i > start:
            end = i
            break
    if start is None:
        raise ValueError(f"marker not found: {start_marker}")
    return "".join(lines[start:end])

# runner/stages.py: from STAGE_RULES through _project_snapshot + classify, resolve, find
stages_body = extract("# ── 流水线阶段映射", "# ── 子进程 stream-json")
stages = '''"""Pipeline stage classification and project path helpers."""
from __future__ import annotations

import re
from pathlib import Path

''' + stages_body.split("STAGE_RULES", 1)[0].split("from backend.config")[0] + stages_body
# Fix: stages_body includes imports we don't need - rewrite cleanly

stages_content = '''"""Pipeline stage classification and project path helpers."""
from __future__ import annotations

import re
from pathlib import Path

''' 
# Extract from line 63 to 155 in original
for i, line in enumerate(lines):
    if line.strip().startswith("STAGE_RULES"):
        stage_start = i
    if "# ── 子进程 stream-json" in line:
        stage_end = i
        break
stages_content += "".join(lines[stage_start:stage_end])
(ROOT / "backend/runner/stages.py").write_text(stages_content)

# runner/docker.py: _split through _start_docker_watchdog
for i, line in enumerate(lines):
    if line.startswith("def _split_claude_args"):
        docker_start = i
    if line.startswith("def stream_claude"):
        docker_end = i
        break
docker_content = '''"""Docker runner command construction."""
from __future__ import annotations

import logging
import subprocess
import threading
import uuid
from pathlib import Path

from backend.config import build_claude_env, get_runtime_config

log = logging.getLogger("backend.runner.docker")

''' + "".join(lines[docker_start:docker_end])
(ROOT / "backend/runner/docker.py").write_text(docker_content)

# runner/claude.py: stream_claude
for i, line in enumerate(lines):
    if line.startswith("def stream_claude"):
        claude_start = i
    if "# ── 同步高层包装" in line:
        claude_end = i
        break
claude_content = '''"""Claude CLI stream-json subprocess runner."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Callable

from backend.config import build_claude_env, get_runtime_config
from backend.runner.constants import PPTMASTER
from backend.runner.docker import _build_docker_run_cmd, _start_docker_watchdog
from backend.runner.stages import SPEC_RE, classify_stage

log = logging.getLogger("backend.runner.claude")

''' + "".join(lines[claude_start:claude_end])
(ROOT / "backend/runner/claude.py").write_text(claude_content)

# runner/sync.py: run_sync and resume_sync
for i, line in enumerate(lines):
    if line.startswith("def run_sync"):
        sync_start = i
    if "# ── async 入口" in line:
        sync_end = i
        break
sync_content = '''"""Synchronous high-level run/resume wrappers."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from backend.config import get_runtime_config
from backend.runner.claude import stream_claude
from backend.runner.constants import AUTO_CONFIRM_TEXT, SKIP_EIGHT_CONFIRM_MAX
from backend.runner.stages import _project_snapshot, find_pptx, resolve_project_dir, build_initial_prompt

log = logging.getLogger("backend.runner.sync")

''' + "".join(lines[sync_start:sync_end])
(ROOT / "backend/runner/sync.py").write_text(sync_content)

# Fix stages.py - need build_initial_prompt and _project_snapshot in stages
# build_initial_prompt is before stream section - add to stages
for i, line in enumerate(lines):
    if line.startswith("def build_initial_prompt"):
        bip_start = i
    if "# ── 子进程 stream-json" in line:
        bip_end = i
        break
extra = "".join(lines[bip_start:bip_end])
stages_content = (ROOT / "backend/runner/stages.py").read_text()
if "def build_initial_prompt" not in stages_content:
    stages_content += "\n" + extra
    (ROOT / "backend/runner/stages.py").write_text(stages_content)

# Remove _project_snapshot from sync imports if in stages - sync imports _project_snapshot from stages - good

# runtime/events.py
for i, line in enumerate(lines):
    if line.startswith("def _next_seq"):
        ev_start = i
    if line.startswith("async def run_job"):
        ev_end = i
        break
events_content = '''"""SSE event persistence and fanout."""
from __future__ import annotations

import asyncio
import json
import logging
import threading

from backend.db.session import SessionLocal
from backend.models import Event as DbEvent
from backend.models import Job as DbJob
from backend.runtime.state import _seq_counters, _seq_locks, _subscribers

log = logging.getLogger("backend.runtime.events")

''' + "".join(lines[ev_start:ev_end])
(ROOT / "backend/runtime/events.py").write_text(events_content)

# runtime/queue.py
queue_funcs = []
for i, line in enumerate(lines):
    if line.startswith("def queue_count"):
        q_start = i
    if line.startswith("def _next_seq"):
        q_end = i
        break
queue_content = '''"""Job queue position and active slot tracking."""
from __future__ import annotations

from backend.db.session import SessionLocal
from backend.models import Job as DbJob
from backend.config import get_runtime_config
from backend.runtime.state import _active_job_ids

''' + "".join(lines[q_start:q_end])
(ROOT / "backend/runtime/queue.py").write_text(queue_content)

# Add active_count etc from after unsubscribe
for i, line in enumerate(lines):
    if line.startswith("def active_count"):
        ac_start = i
    if line.startswith("def _event_to_db_payload"):
        ac_end = i
        break
(ROOT / "backend/runtime/queue.py").write_text(
    (ROOT / "backend/runtime/queue.py").read_text() + "\n" + "".join(lines[ac_start:ac_end])
)

# runtime/events.py - add _event_to_db_payload
for i, line in enumerate(lines):
    if line.startswith("def _event_to_db_payload"):
        etd_start = i
    if line.startswith("async def run_job"):
        etd_end = i
        break
(ROOT / "backend/runtime/events.py").write_text(
    (ROOT / "backend/runtime/events.py").read_text() + "\n" + "".join(lines[etd_start:etd_end])
)

# runtime/init.py - init_runtime, cleanup_stuck_jobs
for i, line in enumerate(lines):
    if line.startswith("def init_runtime"):
        init_start = i
    if "# ── Activity watchdog" in line:
        init_end = i
        break
init_content = '''"""Runtime initialization and startup cleanup."""
from __future__ import annotations

import logging

from backend.db.session import SessionLocal, init_db
from backend.models import Job as DbJob
from backend.runtime.state import _dispatcher_event

log = logging.getLogger("backend.runtime.init")

''' + "".join(lines[init_start:init_end])
(ROOT / "backend/runtime/init.py").write_text(init_content)

# runtime/watchdog.py
for i, line in enumerate(lines):
    if line.startswith("def _kill_tracked_proc"):
        wd_start = i
    if line.startswith("def start_dispatcher"):
        wd_end = i
        break
watchdog_content = '''"""Stale job watchdog."""
from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess

from backend.config import get_runtime_config
from backend.db.session import SessionLocal, _is_sqlite
from backend.models import Job as DbJob
from backend.models import User
from backend.paths import project_root_for
from backend.runtime.events import _enqueue_event
from backend.runtime.jobs import notify_dispatcher
from backend.runtime.state import (
    _active_cancel_events,
    _active_job_ids,
    _active_proc_holders,
    _watchdog_task,
)

log = logging.getLogger("backend.runtime.watchdog")

''' + "".join(lines[wd_start:wd_end])
(ROOT / "backend/runtime/watchdog.py").write_text(watchdog_content)

# runtime/jobs.py - notify_dispatcher, queue_resume, cancel_active, _collect_upload_paths (before run_job)
for i, line in enumerate(lines):
    if line.startswith("def notify_dispatcher"):
        jobs_start = i
    if line.startswith("async def _dispatcher_loop"):
        jobs_mid = i
    if line.startswith("def _collect_upload_paths"):
        cup_start = i
    if line.startswith("async def resume_job"):
        cup_end = i
    if line.startswith("def cancel_active"):
        cancel_start = i
        cancel_end = len(lines)

jobs_content = '''"""Job lifecycle helpers (cancel, notify, uploads)."""
from __future__ import annotations

import logging

from backend.db.session import SessionLocal
from backend.models import Job as DbJob
from backend.paths import uploads_dir_for
from backend.runtime.events import _enqueue_event
from backend.runtime.state import (
    _active_cancel_events,
    _active_proc_holders,
    _dispatcher_event,
)

log = logging.getLogger("backend.runtime.jobs")

''' + "".join(lines[jobs_start:jobs_mid]) + "\n" + "".join(lines[cup_start:cup_end])
(ROOT / "backend/runtime/jobs.py").write_text(jobs_content)

# runtime/dispatcher.py
for i, line in enumerate(lines):
    if line.startswith("def start_dispatcher"):
        disp_start = i
    if line.startswith("def queue_count"):
        disp_end = i
        break
for i, line in enumerate(lines):
    if line.startswith("async def run_job"):
        run_start = i
    if line.startswith("def cancel_active"):
        run_end = i
        break
dispatcher_content = '''"""Job dispatcher and async run/resume entrypoints."""
from __future__ import annotations

import asyncio
import logging
import threading

from backend.db.session import SessionLocal, init_db
from backend.models import Job as DbJob
from backend.models import User
from backend.paths import project_root_for
from backend.runtime.events import _enqueue_event, _event_to_db_payload
from backend.runtime.init import init_runtime
from backend.runtime.jobs import _collect_upload_paths, notify_dispatcher
from backend.runtime.queue import active_count, queue_count
from backend.runtime.state import (
    _active_cancel_events,
    _active_job_ids,
    _active_proc_holders,
    _dispatcher_event,
    _dispatcher_task,
)
from backend.runner.sync import resume_sync, run_sync

log = logging.getLogger("backend.runtime.dispatcher")

''' + "".join(lines[disp_start:disp_end]) + "\n" + "".join(lines[run_start:run_end])
(ROOT / "backend/runtime/dispatcher.py").write_text(dispatcher_content)

# runtime/__init__.py - public re-exports
runtime_init = '''"""Runtime orchestration: dispatcher, SSE, queue, watchdog."""
from backend.runtime.dispatcher import (
    resume_job,
    run_job,
    start_dispatcher,
    stop_dispatcher,
)
from backend.runtime.events import subscribe, unsubscribe
from backend.runtime.init import cleanup_stuck_jobs, init_runtime
from backend.runtime.jobs import cancel_active, notify_dispatcher, queue_resume
from backend.runtime.queue import (
    active_count,
    active_job_ids,
    get_active_job_id,
    has_capacity,
    is_active,
    queue_count,
    queue_position,
)
from backend.runtime.watchdog import start_watchdog, stop_watchdog

__all__ = [
    "active_count",
    "active_job_ids",
    "cancel_active",
    "cleanup_stuck_jobs",
    "get_active_job_id",
    "has_capacity",
    "init_runtime",
    "is_active",
    "notify_dispatcher",
    "queue_count",
    "queue_position",
    "queue_resume",
    "resume_job",
    "run_job",
    "start_dispatcher",
    "start_watchdog",
    "stop_dispatcher",
    "stop_watchdog",
    "subscribe",
    "unsubscribe",
]
'''
(ROOT / "backend/runtime/__init__.py").write_text(runtime_init)

runner_init = '''"""Claude runner: sync execution layer."""
from backend.runner.claude import stream_claude
from backend.runner.stages import classify_stage, find_pptx, resolve_project_dir
from backend.runner.sync import resume_sync, run_sync

__all__ = [
    "classify_stage",
    "find_pptx",
    "resolve_project_dir",
    "resume_sync",
    "run_sync",
    "stream_claude",
]
'''
(ROOT / "backend/runner/__init__.py").write_text(runner_init)

print("Split complete")
