"""Admin API：用户/任务/运行时配置管理。"""
from __future__ import annotations

import json
import logging
import os
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func

from backend.auth import AdminUser, hash_password
from backend.config import get_config_response, get_runtime_config, update_runtime_config
from backend.runtime import (
    active_count,
    active_job_ids,
    cancel_active,
    is_active,
    notify_dispatcher,
    queue_count,
)
from backend.db.session import SessionLocal
from backend.models import AdminActionLog, Event, Job, User

log = logging.getLogger("backend.admin")

router = APIRouter(tags=["admin"])


def _log_action(
    admin_id: str,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    payload: dict | None = None,
) -> None:
    with SessionLocal() as s:
        s.add(AdminActionLog(
            admin_user_id=admin_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            payload_json=json.dumps(payload or {}, ensure_ascii=False),
        ))
        s.commit()


def _admin_count(s) -> int:
    return s.query(func.count(User.id)).filter(User.role == "admin").scalar() or 0


def _job_dict(j: Job) -> dict:
    return {
        "id": j.id,
        "user_id": j.user_id,
        "prompt": j.prompt[:200] + ("..." if len(j.prompt) > 200 else ""),
        "project_name": j.project_name,
        "status": j.status,
        "session_id": j.session_id,
        "cost_usd": j.cost_usd,
        "error_message": j.error_message,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "updated_at": j.updated_at.isoformat() if j.updated_at else None,
    }


@router.get("/overview")
async def admin_overview(admin: AdminUser) -> dict:
    cfg = get_runtime_config()
    with SessionLocal() as s:
        job_stats = {}
        for st in ("queued", "running", "paused", "done", "failed", "cancelled"):
            job_stats[st] = s.query(func.count(Job.id)).filter(Job.status == st).scalar() or 0
        total_jobs = sum(job_stats.values())
        total_users = s.query(func.count(User.id)).scalar() or 0
        admin_users = _admin_count(s)
        recent_failed = (
            s.query(Job)
            .filter(Job.status == "failed")
            .order_by(Job.updated_at.desc())
            .limit(10)
            .all()
        )
    return {
        "runtime": {
            "active_count": active_count(),
            "active_job_ids": active_job_ids(),
            "queue_length": queue_count(),
            "max_concurrent_jobs": cfg.max_concurrent_jobs,
            "server_pid": os.getpid(),
        },
        "jobs": {
            "total": total_jobs,
            **job_stats,
        },
        "users": {"total": total_users, "admins": admin_users},
        "recent_errors": [
            {"id": j.id, "error_message": j.error_message, "updated_at": j.updated_at.isoformat()}
            for j in recent_failed
        ],
    }


@router.get("/settings")
async def get_settings(admin: AdminUser) -> dict:
    return get_config_response()


class SettingsPatch(BaseModel):
    expected_version: int | None = None
    max_concurrent_jobs: int | None = None
    docker: dict | None = None
    watchdog: dict | None = None
    claude_env: dict | None = None
    secrets: dict | None = None
    # 应用设置：模型配置
    app: dict | None = None           # {"models": [...]}；后端整列表覆盖
    model_api_keys: dict | None = None  # {"<model_id>": "sk-..." or null}；null = 删除


@router.patch("/settings")
async def patch_settings(body: SettingsPatch, admin: AdminUser) -> dict:
    patch = body.model_dump(exclude_unset=True)
    try:
        result = update_runtime_config(patch, admin.id)
    except ValueError as e:
        msg = str(e)
        if msg == "version_conflict":
            raise HTTPException(409, "version conflict; reload settings")
        raise HTTPException(400, msg)
    _log_action(admin.id, "settings.update", "settings", "1", {"version": result["config"]["version"]})
    if result.get("notify_dispatcher"):
        notify_dispatcher()
    return result["config"]


@router.get("/users")
async def list_users(
    admin: AdminUser,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    with SessionLocal() as s:
        query = s.query(User)
        if q:
            query = query.filter(User.email.contains(q.strip().lower()))
        total = query.count()
        rows = query.order_by(User.created_at.desc()).offset(offset).limit(limit).all()
        out = []
        for u in rows:
            job_count = s.query(func.count(Job.id)).filter(Job.user_id == u.id).scalar() or 0
            out.append({
                "id": u.id,
                "email": u.email,
                "role": u.role,
                "quota_credits": u.quota_credits,
                "job_count": job_count,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            })
    return {"users": out, "total": total, "limit": limit, "offset": offset}


class UserPatch(BaseModel):
    role: str | None = None
    quota_credits: int | None = None
    password: str | None = Field(None, min_length=6, max_length=200)


@router.patch("/users/{user_id}")
async def patch_user(user_id: str, body: UserPatch, admin: AdminUser) -> dict:
    with SessionLocal() as s:
        u = s.get(User, user_id)
        if not u:
            raise HTTPException(404, "user not found")
        changes: dict = {}
        if body.role is not None:
            if body.role not in ("user", "admin"):
                raise HTTPException(400, "role must be user or admin")
            if u.role == "admin" and body.role != "admin" and _admin_count(s) <= 1:
                raise HTTPException(400, "cannot demote the last admin")
            u.role = body.role
            changes["role"] = body.role
        if body.quota_credits is not None:
            if body.quota_credits < 0:
                raise HTTPException(400, "quota_credits must be >= 0")
            u.quota_credits = body.quota_credits
            changes["quota_credits"] = body.quota_credits
        if body.password is not None:
            u.password_hash = hash_password(body.password)
            changes["password"] = "reset"
        s.commit()
        out = {
            "id": u.id,
            "email": u.email,
            "role": u.role,
            "quota_credits": u.quota_credits,
        }
    if changes:
        _log_action(admin.id, "user.update", "user", user_id, changes)
    return out


@router.get("/jobs")
async def list_jobs_admin(
    admin: AdminUser,
    status: str | None = None,
    user_id: str | None = None,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    with SessionLocal() as s:
        query = s.query(Job)
        if status:
            query = query.filter(Job.status == status)
        if user_id:
            query = query.filter(Job.user_id == user_id)
        if q:
            qv = f"%{q.strip()}%"
            query = query.filter(
                (Job.project_name.like(qv)) | (Job.prompt.like(qv)) | (Job.id.like(qv))
            )
        total = query.count()
        rows = query.order_by(Job.updated_at.desc()).offset(offset).limit(limit).all()
    return {
        "jobs": [_job_dict(j) for j in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/jobs/{job_id}")
async def get_job_admin(job_id: str, admin: AdminUser) -> dict:
    with SessionLocal() as s:
        j = s.get(Job, job_id)
        if not j:
            raise HTTPException(404, "job not found")
        events = (
            s.query(Event)
            .filter(Event.job_id == job_id)
            .order_by(Event.seq.desc())
            .limit(50)
            .all()
        )
        detail = _job_dict(j)
        detail["prompt"] = j.prompt
        detail["project_dir"] = j.project_dir
        detail["pptx_path"] = j.pptx_path
        detail["events"] = [
            {"seq": e.seq, "type": e.type, "payload": json.loads(e.payload)}
            for e in reversed(events)
        ]
    return detail


@router.post("/jobs/{job_id}/cancel")
async def admin_cancel_job(job_id: str, admin: AdminUser) -> dict:
    with SessionLocal() as s:
        j = s.get(Job, job_id)
        if not j:
            raise HTTPException(404, "job not found")
        status = j.status
    if status == "queued":
        with SessionLocal() as s:
            j2 = s.get(Job, job_id)
            if j2 and j2.status == "queued":
                j2.status = "cancelled"
                j2.error_message = "admin cancelled"
                s.commit()
        _log_action(admin.id, "job.cancel", "job", job_id, {"was": "queued"})
        return {"id": job_id, "status": "cancelled"}
    if status in ("done", "failed", "cancelled"):
        raise HTTPException(400, f"job already terminal: {status}")
    if is_active(job_id):
        ok = cancel_active(job_id)
        if not ok:
            raise HTTPException(500, "cancel failed")
        with SessionLocal() as s:
            j3 = s.get(Job, job_id)
            if j3:
                j3.error_message = "admin cancelled"
                s.commit()
    else:
        with SessionLocal() as s:
            j4 = s.get(Job, job_id)
            if j4 and j4.status not in ("done", "failed", "cancelled"):
                j4.status = "cancelled"
                j4.error_message = "admin cancelled"
                s.commit()
    _log_action(admin.id, "job.cancel", "job", job_id, {"was": status})
    return {"id": job_id, "status": "cancelled"}


class MarkFailedRequest(BaseModel):
    reason: str = "manual admin mark failed"
    refund_credit: bool = False
    cancel_if_running: bool = True


@router.post("/jobs/{job_id}/mark-failed")
async def admin_mark_failed(job_id: str, body: MarkFailedRequest, admin: AdminUser) -> dict:
    with SessionLocal() as s:
        j = s.get(Job, job_id)
        if not j:
            raise HTTPException(404, "job not found")
        prev = j.status
        user_id = j.user_id
    if prev in ("done", "failed", "cancelled"):
        raise HTTPException(400, f"job already terminal: {prev}")
    if body.cancel_if_running and is_active(job_id):
        cancel_active(job_id)
    with SessionLocal() as s:
        j2 = s.get(Job, job_id)
        if j2:
            j2.status = "failed"
            j2.error_message = body.reason
            if body.refund_credit and user_id:
                u = s.get(User, user_id)
                if u:
                    u.quota_credits += 1
            s.commit()
    _log_action(admin.id, "job.mark_failed", "job", job_id, {
        "reason": body.reason,
        "refund_credit": body.refund_credit,
        "was": prev,
    })
    return {"id": job_id, "status": "failed"}


class RefundRequest(BaseModel):
    credits: int = Field(..., ge=1, le=1000)
    reason: str = "manual refund"


@router.post("/jobs/{job_id}/refund")
async def admin_refund(job_id: str, body: RefundRequest, admin: AdminUser) -> dict:
    with SessionLocal() as s:
        j = s.get(Job, job_id)
        if not j:
            raise HTTPException(404, "job not found")
        if not j.user_id:
            raise HTTPException(400, "job has no user")
        u = s.get(User, j.user_id)
        if not u:
            raise HTTPException(404, "user not found")
        u.quota_credits += body.credits
        s.commit()
        new_quota = u.quota_credits
    _log_action(admin.id, "job.refund", "job", job_id, {
        "credits": body.credits,
        "reason": body.reason,
        "user_id": j.user_id,
    })
    return {"id": job_id, "user_id": j.user_id, "quota_credits": new_quota}
