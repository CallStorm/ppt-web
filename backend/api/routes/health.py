from fastapi import APIRouter

from backend.config import get_runtime_config
from backend.runtime import active_count, active_job_ids, is_active, queue_count

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    cfg = get_runtime_config()
    return {
        "ok": True,
        "active_job": is_active(),
        "active_count": active_count(),
        "active_job_ids": active_job_ids(),
        "queue_length": queue_count(),
        "max_concurrent_jobs": cfg.max_concurrent_jobs,
    }
