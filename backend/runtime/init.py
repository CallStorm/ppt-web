"""Runtime initialization and startup cleanup."""
from __future__ import annotations

import asyncio
import logging

from backend.db.session import SessionLocal, init_db
from backend.models import Job as DbJob
from backend.runtime import state
from backend.runtime.events import start_event_writer
from backend.runner.errors import humanize_error

log = logging.getLogger("backend.runtime.init")


def init_runtime() -> None:
    """在 event loop 里调用一次：建表 + 建 asyncio.Event。"""
    init_db()
    start_event_writer()
    if state._dispatcher_event is None:
        state._dispatcher_event = asyncio.Event()


def cleanup_stuck_jobs() -> int:
    """启动时清理上次没跑完的 running job。"""
    with SessionLocal() as s:
        running = s.query(DbJob).filter(DbJob.status == "running").all()
        for j in running:
            j.status = "failed"
            log.warning("job %s restart-interrupt raw: server restart interrupted", j.id)
            j.error_message = humanize_error("server restart interrupted your previous run")
            from backend.app.template_service import sync_template_on_job_terminal  # noqa: PLC0415

            sync_template_on_job_terminal(s, j)
        s.commit()
        return len(running)
