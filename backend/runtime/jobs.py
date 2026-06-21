"""Job lifecycle helpers (cancel, notify, uploads)."""
from __future__ import annotations

import logging

from backend.db.session import SessionLocal
from backend.models import Job as DbJob
from backend.paths import uploads_dir_for
from backend.runner.docker import stop_job_container
from backend.runtime import state
from backend.runtime.events import _enqueue_event

log = logging.getLogger("backend.runtime.jobs")

def notify_dispatcher() -> None:
    """唤醒 dispatcher。

    调用时机：
      - create_job 落库后（立刻拉下一个）
      - run_job / resume_job 跑完释放槽位后（让下一个顶上）
      - 取消 job 后（虽然不直接减少 active_count，但触发一次重扫避免过期）
    """
    if state._dispatcher_event is not None:
        state._dispatcher_event.set()


def queue_resume(job_id: str, confirm: str) -> None:
    """resume endpoint 调：把 confirm 写进 Job.pending_confirm + notify。

    dispatcher 看到 pending_confirm IS NOT NULL 时调 resume_job，否则调 run_job。
    """
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if j:
            j.pending_confirm = confirm
            s.commit()
    notify_dispatcher()



def _collect_upload_paths(user_id: str | None, job_id: str) -> list[str]:
    """dispatcher 拉起 run_job 时重新扫 staging 目录得到 upload_paths。

    create_job 阶段已经把文件写到 data/users/<uid>/uploads/<job_id>/，但
    upload_paths 没落库——dispatcher 不在 HTTP 请求上下文里，所以从磁盘重扫。
    """
    if not user_id:
        return []
    d = uploads_dir_for(user_id, job_id)
    if not d.exists():
        return []
    return sorted(str(p.resolve()) for p in d.iterdir() if p.is_file())


def cancel_active(job_id: str) -> bool:
    """请求取消指定 active job。返回是否成功发起取消。"""
    cancel_event = state._active_cancel_events.get(job_id)
    proc_holder = state._active_proc_holders.get(job_id) or []
    if cancel_event is None or not proc_holder:
        return False
    cancel_event.set()
    stop_job_container(job_id)
    proc = proc_holder[0] if proc_holder else None
    if proc and proc.poll() is None:
        try:
            proc.terminate()
        except Exception:
            pass
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if j and j.status in ("queued", "running"):
            j.status = "cancelled"
            j.error_message = "user cancelled"
            s.commit()
    _enqueue_event(job_id, "status", {"status": "cancelled"})
    return True

