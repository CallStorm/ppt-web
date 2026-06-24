import asyncio
import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError

from backend.api.deps import (
    get_job_or_404,
    job_to_dict,
    require_owner_or_admin,
    resolve_job_project_dir,
)
from backend.api.schemas.job_options import job_options_from_form
from backend.auth import CurrentUser
from backend.db.session import SessionLocal
from backend.models import Event, Job, User
from backend.paths import ensure_data_dirs, is_under, project_root_for, safe_stage_name, uploads_dir_for
from backend.runner.preview import find_cover_preview, list_slides
from backend.runtime import (
    cancel_active,
    is_active,
    notify_dispatcher,
    queue_resume,
    subscribe,
    unsubscribe,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])
log = logging.getLogger("backend.api.jobs")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024


@router.post("", status_code=201)
async def create_job(
    user: CurrentUser,
    prompt: Annotated[str, Form(min_length=1, max_length=20000)],
    project_name: Annotated[str | None, Form()] = None,
    language: Annotated[str, Form()] = "zh",
    scenario: Annotated[str, Form()] = "general",
    audience: Annotated[str, Form()] = "general",
    tone: Annotated[str, Form()] = "professional",
    page_count: Annotated[int, Form()] = 5,
    # ── 新增 Tier-1（全部 optional，缺失走默认值） ──
    canvas: Annotated[str, Form()] = "ppt169",
    mode: Annotated[str, Form()] = "briefing",
    visual_style: Annotated[str | None, Form()] = None,
    color_mode: Annotated[str, Form()] = "auto",
    brand_hex: Annotated[str | None, Form()] = None,
    industry: Annotated[str | None, Form()] = None,
    image_strategy: Annotated[str, Form()] = "web",
    core_topic: Annotated[str | None, Form()] = None,
    outline: Annotated[str, Form()] = "",  # 多行文本，前端用 \n 拼
    key_points: Annotated[str, Form()] = "",
    # ── 高级 ──
    icon_strategy: Annotated[str, Form()] = "library",
    formula_policy: Annotated[str, Form()] = "mixed",
    include_speaker_notes: Annotated[bool, Form()] = True,
    split_mode: Annotated[bool, Form()] = False,
    files: Annotated[list[UploadFile], File()] = [],
) -> dict:
    # 多行字段 → list（空串表示没填）
    outline_list = [s.strip() for s in outline.split("\n") if s.strip()] if outline else None
    key_points_list = (
        [s.strip() for s in key_points.split("\n") if s.strip()] if key_points else None
    )

    try:
        opts = job_options_from_form(
            language=language,
            scenario=scenario,
            audience=audience,
            tone=tone,
            page_count=page_count,
            canvas=canvas,
            mode=mode,
            visual_style=visual_style,
            color_mode=color_mode,
            brand_hex=brand_hex,
            industry=industry,
            image_strategy=image_strategy,
            core_topic=core_topic,
            outline=outline_list,
            key_points=key_points_list,
            icon_strategy=icon_strategy,
            formula_policy=formula_policy,
            include_speaker_notes=include_speaker_notes,
            split_mode=split_mode,
        )
    except ValidationError as e:
        raise HTTPException(422, detail=e.errors()) from e

    job_id = str(uuid.uuid4())
    pname = (project_name or f"web_{job_id[:8]}").strip()[:64]
    options_json = json.dumps(opts.model_dump())
    with SessionLocal() as s:
        u = s.get(User, user.id)
        if not u:
            raise HTTPException(401, "user not found")
        if u.quota_credits <= 0:
            raise HTTPException(402, "quota exhausted")
        u.quota_credits -= 1
        s.add(Job(
            id=job_id,
            user_id=u.id,
            prompt=prompt,
            project_name=pname,
            status="queued",
            require_confirm=False,
            options_json=options_json,
        ))
        s.commit()

    uploads_dir = uploads_dir_for(user.id, job_id)
    ensure_data_dirs(user.id, job_id)

    upload_paths: list[str] = []
    total = 0
    for f in files or []:
        if not f.filename:
            continue
        safe = safe_stage_name(f.filename)
        dest = uploads_dir / safe
        if not is_under(dest, uploads_dir):
            log.warning(f"upload rejected (path traversal?): {f.filename}")
            continue
        size = 0
        try:
            with dest.open("wb") as out:
                while True:
                    chunk = await f.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_SINGLE_FILE_BYTES:
                        out.close()
                        dest.unlink(missing_ok=True)
                        with SessionLocal() as s2:
                            u2 = s2.get(User, user.id)
                            if u2:
                                u2.quota_credits += 1
                                s2.commit()
                        raise HTTPException(413, f"file {f.filename!r} exceeds {MAX_SINGLE_FILE_BYTES//1024//1024}MB")
                    total += len(chunk)
                    if total > MAX_UPLOAD_BYTES:
                        out.close()
                        dest.unlink(missing_ok=True)
                        with SessionLocal() as s2:
                            u2 = s2.get(User, user.id)
                            if u2:
                                u2.quota_credits += 1
                                s2.commit()
                        raise HTTPException(413, f"total upload exceeds {MAX_UPLOAD_BYTES//1024//1024}MB")
                    out.write(chunk)
        finally:
            await f.close()
        upload_paths.append(str(dest.resolve()))

    notify_dispatcher()
    return {
        "id": job_id,
        "project_name": pname,
        "status": "queued",
        "uploads": len(upload_paths),
        "options": opts.model_dump(),
    }


@router.get("")
async def list_jobs(user: CurrentUser, limit: int = 50) -> dict:
    with SessionLocal() as s:
        rows = (
            s.query(Job)
            .filter(Job.user_id == user.id)
            .order_by(Job.updated_at.desc())
            .limit(limit)
            .all()
        )
    return {"jobs": [job_to_dict(j) for j in rows]}


@router.get("/{job_id}")
async def get_job(job_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        return job_to_dict(j)


@router.post("/{job_id}/resume")
async def resume_job_endpoint(
    job_id: str,
    user: CurrentUser,
    request: Request,
    confirm: Annotated[str | None, Form()] = None,
) -> dict:
    body_confirm = ""
    ctype = (request.headers.get("content-type") or "").lower()
    if "application/json" in ctype:
        try:
            raw = await request.json()
        except Exception:
            raw = None
        if isinstance(raw, dict):
            v = raw.get("confirm")
            if isinstance(v, str):
                body_confirm = v
    confirm_text = confirm or body_confirm or ""
    if not confirm_text.strip():
        log.warning("resume confirm empty: confirm=%r body_confirm=%r", confirm, body_confirm)
        raise HTTPException(400, "confirm text is required")
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        if j.status != "paused":
            raise HTTPException(400, f"job status is {j.status}, can only resume paused jobs")
        if not j.session_id:
            raise HTTPException(400, "no session_id to resume")
        j.status = "queued"
        s.commit()
    queue_resume(job_id, confirm_text)
    return {"id": job_id, "status": "queued"}


@router.post("/{job_id}/retry")
async def retry_job_endpoint(job_id: str, user: CurrentUser) -> dict:
    """原地重试：把 failed/cancelled job 复位成 queued，重新走 run_job（非 resume）。

    - 重新扣 owner 1 credit（admin 触发也由 owner 付）。
    - 清旧产物：rmtree project_root（runner 会重新 mkdir）。
    - 复用上传文件：不动 uploads 目录，dispatcher 的 _collect_upload_paths 会重扫。
    - 绝不用 resume_job——失败任务 session 已死，需全新生成。
    """
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        if j.status not in ("failed", "cancelled"):
            raise HTTPException(
                409, f"job status is {j.status}, can only retry failed/cancelled jobs"
            )
        if not j.user_id:
            raise HTTPException(400, "job has no owner to charge")
        u = s.get(User, j.user_id)
        if not u:
            raise HTTPException(400, "owner user not found")
        if u.quota_credits <= 0:
            raise HTTPException(402, "quota exhausted")
        # 重新计费 + 复位行
        u.quota_credits -= 1
        j.status = "queued"
        j.error_message = None
        j.session_id = None
        j.pptx_path = None
        j.cost_usd = 0
        j.project_dir = None
        j.pending_confirm = None
        s.commit()
        owner_id = j.user_id

    # 清旧产物（runner 重新 mkdir）。uploads 目录不动——复用原上传文件。
    if owner_id:
        proj = project_root_for(owner_id, job_id)
        if proj.exists():
            shutil.rmtree(proj, ignore_errors=True)

    notify_dispatcher()
    return {"id": job_id, "status": "queued"}


@router.post("/{job_id}/cancel")
async def cancel_job_endpoint(job_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
    if j.status == "queued":
        with SessionLocal() as s:
            j2 = get_job_or_404(s, job_id)
            require_owner_or_admin(j2, user)
            if j2.status == "queued":
                j2.status = "cancelled"
                j2.error_message = "user cancelled"
                s.commit()
        return {"id": job_id, "status": "cancelled"}
    if not is_active(job_id):
        raise HTTPException(400, "this job is not currently active")
    ok = cancel_active(job_id)
    if not ok:
        raise HTTPException(500, "cancel failed")
    return {"id": job_id, "status": "cancelled"}


def _sse_format(ev: dict) -> str:
    return f"id: {ev['seq']}\nevent: {ev['type']}\ndata: {json.dumps(ev['payload'], ensure_ascii=False)}\n\n"


@router.get("/{job_id}/events")
async def events_stream(
    job_id: str,
    request: Request,
    user: CurrentUser,
    from_seq: int | None = None,
):
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)

    if from_seq is None:
        hdr = request.headers.get("last-event-id")
        try:
            from_seq = int(hdr) if hdr else 0
        except ValueError:
            from_seq = 0

    async def gen():
        with SessionLocal() as s:
            rows = (
                s.query(Event)
                .filter(Event.job_id == job_id, Event.seq > from_seq)
                .order_by(Event.seq)
                .all()
            )
            replay_done_at = max((r.seq for r in rows), default=from_seq)
            history = [
                {"seq": r.seq, "type": r.type, "payload": json.loads(r.payload)}
                for r in rows
            ]
            current_status = s.get(Job, job_id).status if s.get(Job, job_id) else None

        for ev in history:
            if await request.is_disconnected():
                return
            yield _sse_format(ev)
            if ev["type"] in ("pptx",) and ev["payload"].get("url"):
                return

        if current_status in ("done", "failed", "cancelled"):
            return

        q = subscribe(job_id)
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if ev["seq"] <= replay_done_at:
                    continue
                yield _sse_format(ev)
                if ev["type"] == "pptx" and ev["payload"].get("url"):
                    return
        finally:
            unsubscribe(job_id, q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{job_id}/pptx")
async def download_pptx(job_id: str, user: CurrentUser):
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        if not j.pptx_path or not Path(j.pptx_path).exists():
            raise HTTPException(404, "pptx not ready")
    return FileResponse(
        j.pptx_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"{j.project_name}.pptx",
    )


_PREVIEW_MEDIA = {
    ".png": "image/png",
    ".svg": "image/svg+xml",
}


@router.get("/{job_id}/preview")
async def download_preview(job_id: str, user: CurrentUser):
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        project_dir = resolve_job_project_dir(j)
        preview = find_cover_preview(project_dir)
        if not preview:
            raise HTTPException(404, "preview not ready")

        allowed_roots = []
        if j.user_id:
            allowed_roots.append(project_root_for(j.user_id, j.id).resolve())
        if j.project_dir:
            allowed_roots.append(Path(j.project_dir).resolve().parent)

        preview_resolved = preview.resolve()
        if not any(is_under(preview_resolved, root) for root in allowed_roots):
            raise HTTPException(403, "preview path forbidden")

        media_type = _PREVIEW_MEDIA.get(preview.suffix.lower(), "application/octet-stream")
        return FileResponse(preview, media_type=media_type)


def _verified_slides(j: Job) -> list[dict]:
    """Ordered slide descriptors for ``j``, path-traversal-guarded.

    Mirrors the allowed-roots check used by ``/preview``: a slide file must live
    under either the user's project root or the recorded ``project_dir`` parent.
    """
    project_dir = resolve_job_project_dir(j)
    slides = list_slides(project_dir)
    if not slides:
        return []

    allowed_roots: list[Path] = []
    if j.user_id:
        allowed_roots.append(project_root_for(j.user_id, j.id).resolve())
    if j.project_dir:
        allowed_roots.append(Path(j.project_dir).resolve().parent)

    verified: list[dict] = []
    for sl in slides:
        try:
            resolved = sl["path"].resolve()
        except (OSError, ValueError):
            continue
        if any(is_under(resolved, root) for root in allowed_roots):
            verified.append(sl)
    return verified


@router.get("/{job_id}/slides")
async def list_job_slides(job_id: str, user: CurrentUser) -> dict:
    """Per-slide manifest for the preview modal (PNG render if present, else SVG)."""
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
    slides = _verified_slides(j)
    if not slides:
        raise HTTPException(404, "no slides available")
    return {
        "slides": [
            {
                "index": sl["index"],
                "name": sl["name"],
                "image_url": f"/api/jobs/{job_id}/slides/{sl['index']}",
                "has_notes": sl["has_notes"],
                "notes_url": f"/api/jobs/{job_id}/slides/{sl['index']}/notes" if sl["has_notes"] else None,
            }
            for sl in slides
        ]
    }


@router.get("/{job_id}/slides/{slide_index}")
async def get_job_slide(job_id: str, slide_index: int, user: CurrentUser):
    """A single slide image (SVG, or PNG when a render exists)."""
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
    slides = _verified_slides(j)
    if not slides:
        raise HTTPException(404, "no slides available")
    sl = next((x for x in slides if x["index"] == slide_index), None)
    if not sl:
        raise HTTPException(404, f"slide {slide_index} not found")
    return FileResponse(sl["path"], media_type=sl["media_type"])


@router.get("/{job_id}/slides/{slide_index}/notes")
async def get_job_slide_notes(job_id: str, slide_index: int, user: CurrentUser) -> str:
    """Speaker notes (Markdown) for a single slide, as plain text."""
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
    slides = _verified_slides(j)
    if not slides:
        raise HTTPException(404, "no slides available")
    sl = next((x for x in slides if x["index"] == slide_index), None)
    if not sl or not sl["has_notes"] or sl["notes_path"] is None:
        raise HTTPException(404, "notes not found")
    try:
        return sl["notes_path"].read_text(encoding="utf-8")
    except OSError as e:
        raise HTTPException(500, f"cannot read notes: {e}") from e


@router.delete("/{job_id}")
async def delete_job(job_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        if j.status in ("running", "paused"):
            raise HTTPException(400, "cannot delete a running job; cancel it first")
        user_id = j.user_id

    if is_active(job_id):
        cancel_active(job_id)

    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        if j.status in ("running", "paused"):
            raise HTTPException(400, "cannot delete a running job; cancel it first")
        s.query(Event).filter(Event.job_id == job_id).delete()
        s.delete(j)
        s.commit()

    if user_id:
        uploads = uploads_dir_for(user_id, job_id)
        projects = project_root_for(user_id, job_id)
        for path in (uploads, projects):
            if path.exists():
                shutil.rmtree(path, ignore_errors=True)

    notify_dispatcher()
    return {"id": job_id, "deleted": True}
