"""Shared API dependencies."""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from backend.api.schemas.job_options import parse_job_options
from backend.models import Job, User
from backend.paths import is_under, project_root_for
from backend.runner.preview import find_cover_preview
from backend.runner.stages import resolve_project_dir
from backend.runtime import queue_position


def resolve_job_project_dir(j: Job) -> Path | None:
    if j.project_dir:
        p = Path(j.project_dir)
        if p.is_dir():
            return p
    if j.pptx_path and not str(j.pptx_path).startswith("/api/"):
        pptx = Path(j.pptx_path)
        if pptx.is_file() and pptx.parent.name == "exports":
            project = pptx.parent.parent
            if project.is_dir():
                return project
    if not j.user_id or not j.project_name:
        return None
    root = project_root_for(j.user_id, j.id)
    return resolve_project_dir(j.project_name, root=root)


def job_has_preview(j: Job) -> bool:
    return find_cover_preview(resolve_job_project_dir(j)) is not None


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
        "has_preview": job_has_preview(j),
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
