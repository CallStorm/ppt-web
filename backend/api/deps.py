"""Shared API dependencies."""
from __future__ import annotations

from fastapi import HTTPException

from backend.api.schemas.job_options import parse_job_options
from backend.models import Job, User
from backend.runtime import queue_position


def job_to_dict(j: Job) -> dict:
    opts = parse_job_options(j.options_json)
    return {
        "id": j.id,
        "user_id": j.user_id,
        "prompt": j.prompt,
        "project_name": j.project_name,
        "status": j.status,
        "session_id": j.session_id,
        "project_dir": j.project_dir,
        "pptx_path": j.pptx_path,
        "cost_usd": j.cost_usd,
        "last_agent_text": j.last_agent_text,
        "last_event_seq": j.last_event_seq,
        "require_confirm": j.require_confirm,
        "options": opts.model_dump() if opts else None,
        "error_message": j.error_message,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
        "queue_position": queue_position(j.id),
    }


def get_job_or_404(s, job_id: str) -> Job:
    j = s.get(Job, job_id)
    if not j:
        raise HTTPException(404, f"job {job_id} not found")
    return j


def require_owner_or_admin(job: Job, user: User) -> None:
    if user.role == "admin":
        return
    if job.user_id != user.id:
        raise HTTPException(403, "forbidden: not your job")
