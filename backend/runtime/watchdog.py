"""Stale job watchdog."""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import literal_column

from backend.config import get_runtime_config
from backend.db.session import SessionLocal, _is_sqlite
from backend.models import Job as DbJob
from backend.models import User
from backend.runner.docker import stop_job_container
from backend.runner.errors import humanize_error
from backend.runtime import state
from backend.runtime.events import _enqueue_event
from backend.runtime.jobs import notify_dispatcher

log = logging.getLogger("backend.runtime.watchdog")


def _kill_tracked_proc(job_id: str) -> bool:
    """kill _active_proc_holders 里 server 持有的 docker run 父进程。返回是否 kill 成功。"""
    holder = state._active_proc_holders.get(job_id)
    if not holder:
        return False
    proc = holder[0] if holder else None
    if not proc:
        return False
    try:
        if proc.poll() is None:
            proc.kill()
            log.warning("watchdog: killed tracked docker run pid=%s for job %s", proc.pid, job_id)
            return True
    except Exception as e:
        log.warning("watchdog: kill tracked proc failed for %s: %s", job_id, e)
    return False


def _sweep_stale_jobs() -> int:
    """扫描 stale running jobs → stop container + mark failed + refund + 通知 dispatcher。

    返回处理数量。
    """
    stale_ids: list[str] = []
    threshold_seconds = get_runtime_config().watchdog.stale_secs

    with SessionLocal() as s:
        if _is_sqlite():
            cutoff_expr = literal_column(f"datetime('now', '-{threshold_seconds} seconds')")
        else:
            cutoff_expr = literal_column(
                f"DATE_SUB(UTC_TIMESTAMP(), INTERVAL {threshold_seconds} SECOND)"
            )
        stale = (
            s.query(DbJob)
            .filter(DbJob.status == "running", DbJob.updated_at < cutoff_expr)
            .all()
        )
        for j in stale:
            stale_ids.append(j.id)
            stopped = False
            if _kill_tracked_proc(j.id):
                stopped = True
            if stop_job_container(j.id):
                stopped = True
            j.status = "failed"
            raw = (
                f"watchdog: no event for {threshold_seconds}s; "
                f"stopped container={'yes' if stopped else 'no'}"
            )
            log.warning("job %s watchdog raw: %s", j.id, raw)
            j.error_message = humanize_error(raw)
            if j.user_id:
                u = s.get(User, j.user_id)
                if u:
                    u.quota_credits += 1
                    log.info("watchdog: refund 1 credit to user %s (job %s)",
                             j.user_id, j.id)
            from backend.app.template_service import sync_template_on_job_terminal  # noqa: PLC0415

            sync_template_on_job_terminal(s, j)
        if stale:
            s.commit()

    for jid in stale_ids:
        state._active_job_ids.discard(jid)
        state._active_proc_holders.pop(jid, None)
        state._active_cancel_events.pop(jid, None)
        _enqueue_event(jid, "status", {"status": "failed"})

    if stale_ids:
        notify_dispatcher()
        log.warning(
            "watchdog: cleaned %d stale job(s) (threshold=%ds): %s",
            len(stale_ids), threshold_seconds, stale_ids,
        )
    return len(stale_ids)


async def _watchdog_loop() -> None:
    """每 interval 秒跑一次 _sweep_stale_jobs。"""
    cfg = get_runtime_config()
    log.info("watchdog loop running (interval=%ds, stale=%ds)",
             cfg.watchdog.interval_s, cfg.watchdog.stale_secs)
    while True:
        try:
            await asyncio.sleep(get_runtime_config().watchdog.interval_s)
            _sweep_stale_jobs()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("watchdog error: %s", e)


def start_watchdog() -> None:
    if state._watchdog_task is not None and not state._watchdog_task.done():
        return
    state._watchdog_task = asyncio.create_task(_watchdog_loop())
    cfg = get_runtime_config()
    log.info("watchdog started (stale=%ds, interval=%ds)",
             cfg.watchdog.stale_secs, cfg.watchdog.interval_s)


async def stop_watchdog() -> None:
    if state._watchdog_task is None:
        return
    if not state._watchdog_task.done():
        state._watchdog_task.cancel()
        try:
            await state._watchdog_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.warning("watchdog stop: %s", e)
    state._watchdog_task = None
    log.info("watchdog stopped")

