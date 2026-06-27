import asyncio
import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from backend.api.deps import (
    get_job_or_404,
    job_to_dict,
    require_owner_or_admin,
    resolve_job_project_dir,
)
from backend.api.schemas.job_options import (
    GlobalRevision,
    RevisionItem,
    RevisionRequest,
    job_options_from_form,
)
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
async def list_jobs(
    user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    with SessionLocal() as s:
        query = s.query(Job).filter(Job.user_id == user.id)
        total = query.count()
        rows = (
            query.order_by(Job.updated_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
    return {
        "jobs": [job_to_dict(j) for j in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


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
            raise HTTPException(
                400,
                "会话已丢失，无法继续确认；请删除该任务后重新创建，或对已失败任务使用重试",
            )
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
        if j.status not in ("failed", "cancelled", "paused"):
            raise HTTPException(
                409, f"job status is {j.status}, can only retry failed/cancelled/stale paused jobs"
            )
        if j.status == "paused" and j.session_id:
            raise HTTPException(
                409, "任务仍在等待确认，请提交确认或先取消，不能重试",
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
    if j.status == "paused" and not is_active(job_id):
        with SessionLocal() as s:
            j2 = get_job_or_404(s, job_id)
            require_owner_or_admin(j2, user)
            if j2.status == "paused":
                j2.status = "cancelled"
                j2.error_message = j2.error_message or "user cancelled"
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
        # Health gate: an SVG cover with a wrong namespace renders as a
        # blank card in the job list. 503 with a clear hint beats silence.
        if media_type == "image/svg+xml" and not _is_renderable_svg(preview):
            raise HTTPException(
                503,
                "cover preview has an invalid SVG namespace; re-run finalize_svg or regenerate",
            )
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
    out = []
    for sl in slides:
        renderable = (
            sl["media_type"] != "image/svg+xml" or _is_renderable_svg(sl["path"])
        )
        # Mark broken slides so the UI can show a "needs repair" chip
        # instead of pointing the user at a URL that will 503.
        out.append(
            {
                "index": sl["index"],
                "name": sl["name"],
                "image_url": f"/api/jobs/{job_id}/slides/{sl['index']}"
                if renderable
                else None,
                "has_notes": sl["has_notes"],
                "notes_url": f"/api/jobs/{job_id}/slides/{sl['index']}/notes"
                if sl["has_notes"]
                else None,
                "renderable": renderable,
                "repair_hint": (
                    None
                    if renderable
                    else "invalid SVG namespace — re-run finalize_svg or regenerate this page"
                ),
            }
        )
    return {"slides": out}


def _is_renderable_svg(path) -> bool:
    """Return True iff ``path`` is an SVG whose root element is the
    canonical ``{http://www.w3.org/2000/svg}svg``.

    The Executor (LLM) occasionally emits SVGs with a wrong namespace URI
    (the common hallucination is ``http://www.w3.org/1990/svg`` bound to
    a ``ns0:`` prefix). Browsers refuse to render any element outside the
    SVG namespace, so the page comes back blank. The previews pipeline
    now self-heals stale pages, but this is the last-line check that the
    file we're about to hand to the browser is actually renderable — a
    broken file means the repair step missed it, and the caller should
    see a clear 503, not a silent blank canvas.
    """
    if path is None:
        return False
    try:
        from lxml import etree as _et
        root = _et.parse(str(path)).getroot()
    except Exception:
        return False
    return _et.QName(root.tag).namespace == "http://www.w3.org/2000/svg"


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
    if sl["media_type"] == "image/svg+xml" and not _is_renderable_svg(sl["path"]):
        raise HTTPException(
            503,
            f"slide {slide_index} has an invalid SVG namespace; "
            "re-run finalize_svg or click 'regenerate' to repair",
        )
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
        if j.status == "running" or (j.status == "paused" and is_active(job_id)):
            raise HTTPException(400, "cannot delete a running job; cancel it first")
        user_id = j.user_id

    if is_active(job_id):
        cancel_active(job_id)

    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
        if j.status == "running" or (j.status == "paused" and is_active(job_id)):
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


# ---------------------------------------------------------------------------
# Image-candidate review endpoints
# ---------------------------------------------------------------------------
#
# Rationale: the image-search pipeline saves the top-N candidates it
# considered for each slide to ``candidates/<stem>/candidate_*.jpg`` plus
# a ``candidates.json`` manifest. The frontend is expected to display
# them as a grid and require an explicit user pick before finalize uses
# that image — without that "the human has to see the picture" step, a
# disturbing off-topic image (e.g. a mouth photo for a "tired
# businessperson" pain slide) can end up in the final deck.


@router.get("/{job_id}/image-candidates")
async def list_image_candidates(job_id: str, user: CurrentUser) -> dict:
    """For each image-having slide, list the saved candidates with a
    thumbnail URL, attribution, and a ``confirmed`` flag.

    The frontend uses this to render the "review your selected images"
    grid and only allows finalize after every slide's image is
    explicitly confirmed.
    """
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
    project_dir = resolve_job_project_dir(j)
    if not project_dir:
        return {"items": []}
    candidates_root = project_dir / "candidates"
    if not candidates_root.is_dir():
        return {"items": []}
    items: list[dict] = []
    for stem_dir in sorted(candidates_root.iterdir()):
        if not stem_dir.is_dir():
            continue
        manifest_path = stem_dir / "candidates.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        cands = manifest.get("candidates", [])
        # Also include a "confirmed" flag persisted as a sidecar file
        # so the choice survives page reloads.
        confirmation_path = stem_dir / ".confirmed"
        confirmed = confirmation_path.is_file()
        items.append(
            {
                "stem": stem_dir.name,
                "target_filename": manifest.get("target_filename", ""),
                "selected": manifest.get("selected", ""),
                "confirmed": confirmed,
                "candidates": [
                    {
                        "rank": c.get("rank"),
                        "score": c.get("score"),
                        "filename": c.get("filename"),
                        "title": c.get("title", ""),
                        "author": c.get("author", ""),
                        "license_name": c.get("license_name", ""),
                        "image_url": (
                            f"/api/jobs/{job_id}/image-candidates/"
                            f"{stem_dir.name}/{c.get('filename')}"
                        ),
                    }
                    for c in cands
                ],
            }
        )
    return {"items": items}


@router.get("/{job_id}/image-candidates/{stem}/{filename}")
async def get_image_candidate(
    job_id: str, stem: str, filename: str, user: CurrentUser
):
    """Serve a single candidate thumbnail (path-traversal-guarded)."""
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
    project_dir = resolve_job_project_dir(j)
    if not project_dir:
        raise HTTPException(404, "project not found")
    candidate_path = (project_dir / "candidates" / stem / filename).resolve()
    candidates_root = (project_dir / "candidates").resolve()
    if not is_under(candidate_path, candidates_root):
        raise HTTPException(403, "path forbidden")
    if not candidate_path.is_file():
        raise HTTPException(404, "candidate not found")
    media_type = "image/jpeg"
    if candidate_path.suffix.lower() in (".png",):
        media_type = "image/png"
    elif candidate_path.suffix.lower() in (".webp",):
        media_type = "image/webp"
    return FileResponse(candidate_path, media_type=media_type)


@router.post("/{job_id}/image-candidates/{stem}/confirm")
async def confirm_image_candidate(
    job_id: str, stem: str, user: CurrentUser
) -> dict:
    """Mark the user has seen and accepted the currently-selected image
    for this slide. The frontend must call this after the user clicks
    "accept" on a candidate. Subsequent finalize runs are not gated on
    this in the current code path — it's an auditable breadcrumb that
    surfaces in logs and the manifest, so we can detect "user never
    confirmed this image" regressions in the future.
    """
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)
    project_dir = resolve_job_project_dir(j)
    if not project_dir:
        raise HTTPException(404, "project not found")
    stem_dir = project_dir / "candidates" / stem
    if not stem_dir.is_dir():
        raise HTTPException(404, "stem not found")
    confirmation_path = stem_dir / ".confirmed"
    confirmation_path.write_text(
        json.dumps(
            {
                "confirmed_at": int(__import__("time").time()),
                "user_id": str(user.id) if hasattr(user, "id") else None,
            }
        ),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Revisions (post-completion modifications)
# ---------------------------------------------------------------------------
#
# See backend/runtime/revisions.py for the queueing pipeline and the
# prompt template. The route handlers below are thin shims over it —
# every error case returns a clear message the frontend can surface
# verbatim to the user.


class _RevisionBody(RevisionRequest):
    """Alias for OpenAPI — backward compatible with legacy `{ items: [...] }` bodies."""


@router.get("/{job_id}/edit-targets")
async def get_edit_targets(job_id: str, user: CurrentUser) -> dict:
    """Return whether the job is editable, why/why-not, and the slide
    grid the frontend will render inside the Edit modal.

    The slide grid mirrors ``/slides`` so the UI can share the rendering
    component. ``current_note`` is the slide's existing speaker notes
    (if any) — useful as a hint to the user when writing a comment.
    """
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)

    out: dict = {
        "editable": False,
        "reason": None,
        "session_id": j.session_id,
        "pptx_path": j.pptx_path,
        "project_dir": j.project_dir,
        "slides": [],
        "spec_summary": None,
        "job_options": None,
    }
    if j.status != "done":
        out["reason"] = (
            f"job is not done (status={j.status}); only completed decks can be edited"
        )
        return out

    # Verify project_dir is still on disk. This is the file the agent
    # would edit; if it's gone, the user can't be helped.
    if not j.project_dir or not Path(j.project_dir).is_dir():
        out["reason"] = "source deck files are missing on disk; cannot edit"
        return out

    out["editable"] = True
    if not j.session_id:
        out["reason"] = (
            "no session history (likely a server restart); revision will run "
            "in degraded mode and may be less accurate"
        )

    slides = _verified_slides(j)
    for sl in slides:
        notes = ""
        if sl.get("notes_path"):
            try:
                notes = sl["notes_path"].read_text(encoding="utf-8")[:500]
            except OSError:
                notes = ""
        out["slides"].append(
            {
                "index": sl["index"],
                "name": sl["name"],
                "image_url": f"/api/jobs/{job_id}/slides/{sl['index']}",
                "current_note": notes,
            }
        )

    try:
        opts = json.loads(j.options_json) if j.options_json else {}
        out["job_options"] = opts
    except json.JSONDecodeError:
        out["job_options"] = None

    if j.project_dir:
        from backend.runner.spec_lock import build_spec_summary

        out["spec_summary"] = build_spec_summary(
            Path(j.project_dir), page_count=len(out["slides"])
        )

    return out


@router.post("/{job_id}/revisions", status_code=201)
async def post_revision(
    job_id: str, body: _RevisionBody, user: CurrentUser
) -> dict:
    """Submit per-slide or global modification. Creates a new revision
    job, copies the source deck, and queues a ``claude --resume`` run.

    Always deducts 1 credit (same as a fresh job). On failure during
    filesystem copy the credit is refunded.
    """
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)

    slides = _verified_slides(j)
    if not slides:
        raise HTTPException(400, "source job has no slides to edit")
    page_count = len(slides)

    if body.mode == "per_page":
        max_idx = max(sl["index"] for sl in slides)
        seen: set[int] = set()
        for it in body.items or []:
            if it.slide_index < 1 or it.slide_index > max_idx:
                raise HTTPException(
                    400,
                    f"slide_index {it.slide_index} is out of range 1..{max_idx}",
                )
            if it.slide_index in seen:
                raise HTTPException(
                    400, f"duplicate slide_index {it.slide_index} in items"
                )
            seen.add(it.slide_index)
            if not it.comment.strip():
                raise HTTPException(
                    400, f"slide {it.slide_index}: comment is empty"
                )
        slide_names = {sl["index"]: sl["name"] for sl in slides}
    else:
        slide_names = None
        gr = body.global_revision
        if gr is None:
            raise HTTPException(400, "global_revision is required for mode=global")
        if gr.kind in ("colors", "typography") and not j.project_dir:
            raise HTTPException(400, "project_dir missing")
        if gr.kind in ("colors", "typography"):
            lock_path = Path(j.project_dir) / "spec_lock.md"
            if not lock_path.is_file():
                raise HTTPException(
                    400,
                    "spec_lock.md not found; use custom global instruction instead",
                )

    from backend.runtime.revisions import queue_revision, RevisionError
    try:
        if body.mode == "global":
            new_job_id = queue_revision(
                old_job_id=job_id,
                global_revision=body.global_revision,
                user_id=user.id,
                page_count=page_count,
            )
        else:
            new_job_id = queue_revision(
                old_job_id=job_id,
                items=body.items,
                user_id=user.id,
                slide_names=slide_names,
                page_count=page_count,
            )
    except RevisionError as e:
        # Most user-visible failures are 4xx (not done, no credit, …);
        # filesystem failures are 500-ish but we surface them as 400
        # so the frontend shows a friendly message instead of a stack.
        raise HTTPException(400, str(e)) from e
    return {"revision_job_id": new_job_id, "status": "queued"}


@router.get("/{job_id}/revisions")
async def list_revisions(job_id: str, user: CurrentUser) -> dict:
    """List this job's revision history.

    Returns both the "v0" (this job) and any later revisions that point
    back to it via ``revision_of_job_id``. Sorted newest-first; the
    frontend uses the first item as the "latest" for download links.
    """
    with SessionLocal() as s:
        j = get_job_or_404(s, job_id)
        require_owner_or_admin(j, user)

    revisions: list[dict] = []
    children = (
        s.query(Job)
        .filter(Job.revision_of_job_id == job_id)
        .order_by(Job.created_at.desc())
        .all()
    )

    def _item(job_row: Job, *, is_self: bool) -> dict:
        comments: list[dict] = []
        global_summary: str | None = None
        revision_mode: str | None = None
        try:
            opts = json.loads(job_row.options_json) if job_row.options_json else {}
            revision_mode = opts.get("revision_mode")
            if revision_mode == "global" and opts.get("global_revision"):
                from backend.runtime.revisions import format_global_revision_summary

                gr = GlobalRevision.model_validate(opts["global_revision"])
                global_summary = format_global_revision_summary(gr)
            for it in (opts.get("revision_items") or []):
                comments.append(
                    {"slide_index": it.get("slide_index"), "comment": it.get("comment", "")}
                )
        except (json.JSONDecodeError, AttributeError, ValueError):
            pass
        return {
            "job_id": job_row.id,
            "is_self": is_self,
            "is_latest": False,  # filled in below
            "status": job_row.status,
            "created_at": job_row.created_at.isoformat() if job_row.created_at else None,
            "pptx_url": (
                f"/api/jobs/{job_row.id}/pptx" if job_row.status == "done" else None
            ),
            "preview_url": (
                f"/api/jobs/{job_row.id}/preview" if job_row.status == "done" else None
            ),
            "comments": comments,
            "revision_mode": revision_mode,
            "global_summary": global_summary,
        }

    # If this job itself is a revision, the user wants the full chain.
    # Surface the current job as the "self" entry. Children are
    # already sorted newest-first (ORDER BY created_at DESC).
    revisions.append(_item(j, is_self=True))
    for c in children:
        revisions.append(_item(c, is_self=False))

    # Latest = the newest done child when there is one. If no child has
    # finished, fall back to the newest child of any status. Only when
    # there are no children at all do we point "latest" at the source
    # job itself.
    done_children = [r for r in revisions if not r["is_self"] and r["status"] == "done"]
    if done_children:
        latest = done_children[0]
    elif children:
        latest = revisions[1]  # children start at index 1 (right after self)
    else:
        latest = revisions[0]
    latest["is_latest"] = True

    return {"items": revisions}
    return {"ok": True, "stem": stem}
