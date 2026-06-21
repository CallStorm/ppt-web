"""Job queue position and active slot tracking."""
from __future__ import annotations

from backend.db.session import SessionLocal
from backend.models import Job as DbJob
from backend.config import get_runtime_config
from backend.runtime.state import _active_job_ids

def queue_count() -> int:
    """当前 queued 状态的 job 数量（DB 视角）。"""
    with SessionLocal() as s:
        return s.query(DbJob).filter(DbJob.status == "queued").count()


def queue_position(job_id: str) -> int | None:
    """返回 job 在队列中的位置（1-indexed）；不在 queued 返回 None。

    给前端做「您前面还有 N 位」提示用。

    按 dispatcher 同样的优先级排序（pending_confirm 非空优先 + FIFO），
    找到 job_id 在排序列表里的 index。SQLite 的 DateTime 存为秒精度字符串，
    用 `<` 比较 datetime 对象有微秒差异问题；用 list 索引更稳。
    """
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if not j or j.status != "queued":
            return None
        all_queued = (
            s.query(DbJob.id)
            .filter(DbJob.status == "queued")
            .order_by(
                DbJob.pending_confirm.is_(None).asc(),
                DbJob.created_at.asc(),
                DbJob.id.asc(),  # 同 created_at 时按 id 排，保证稳定
            )
            .all()
        )
        for idx, (qid,) in enumerate(all_queued):
            if qid == job_id:
                return idx + 1
        return None  # 理论上不会到这（j 是 queued）



def active_count() -> int:
    return len(_active_job_ids)


def active_job_ids() -> list[str]:
    return sorted(_active_job_ids)


def has_capacity() -> bool:
    """是否还有空槽（dispatcher 拿这个决定能否拉起下一个）。"""
    return active_count() < get_runtime_config().max_concurrent_jobs


def is_active(job_id: str | None = None) -> bool:
    if job_id is not None:
        return job_id in _active_job_ids
    return bool(_active_job_ids)


def get_active_job_id() -> str | None:
    # 向后兼容：老调用只关心单 active，返回任意一个
    return next(iter(_active_job_ids), None)


