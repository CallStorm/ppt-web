"""Runtime initialization and startup cleanup."""
from __future__ import annotations

import asyncio
import logging

from backend.db.session import SessionLocal, init_db
from backend.models import Job as DbJob
from backend.runtime import state

log = logging.getLogger("backend.runtime.init")


def init_runtime() -> None:
    """在 event loop 里调用一次：建表 + 建 asyncio.Event。"""
    init_db()
    if state._dispatcher_event is None:
        state._dispatcher_event = asyncio.Event()


def cleanup_stuck_jobs() -> int:
    """启动时清理上次没跑完的 running job。"""
    with SessionLocal() as s:
        running = s.query(DbJob).filter(DbJob.status == "running").all()
        for j in running:
            j.status = "failed"
            j.error_message = "server restart interrupted your previous run"
        s.commit()
        return len(running)
