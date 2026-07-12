"""Template catalog API — system / global / user scopes."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.app.template_service import (
    SLUG_RE,
    analyze_pptx,
    build_template_create_prompt,
    create_template_record,
    delete_template,
    fork_system_template,
    get_catalog_entry,
    list_catalog_entries,
    list_categories,
    list_template_tasks,
    publish_template,
    retry_template_task,
    suggest_unique_slug,
    template_row_to_entry,
)
from backend.app.templates import (
    TemplateKind,
    resolve_preview_file,
)
from backend.auth import CurrentUser
from backend.db.session import SessionLocal
from backend.models import Job, Template, TemplateCategory, User
from backend.paths import TEMPLATE_STAGING_DIR, project_root_for, safe_stage_name
from backend.runtime import notify_dispatcher

router = APIRouter(prefix="/templates", tags=["templates"])

TemplateKindParam = Literal["deck", "layout"]
TemplateScopeParam = Literal["system", "global", "user"]

MAX_PPTX_BYTES = 25 * 1024 * 1024


class CategoryCreateBody(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    sort_order: int = 0


class CategoryPatchBody(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class TemplateBriefBody(BaseModel):
    staging_id: str
    slug: str
    display_name: str
    kind: TemplateKindParam = "deck"
    scope: TemplateScopeParam | None = None
    category_id: str | None = None
    canvas_format: str = "ppt169"
    canvas_width: int = 1280
    canvas_height: int = 720
    canvas_viewbox: str = "0 0 1280 720"
    replication_mode: str = "standard"
    native_structure_mode: str = "template"
    visual_fidelity: str = "literal"
    theme_mode: str = "light"
    summary: str = ""
    keywords: list[str] = Field(default_factory=list)
    primary_color: str | None = None
    page_count: int = 0
    asset_selection: list[str] = Field(default_factory=list)


class TemplatePatchBody(BaseModel):
    display_name: str | None = None
    category_id: str | None = None


class SuggestSlugBody(BaseModel):
    slug: str = Field(min_length=1, max_length=64)
    kind: TemplateKindParam = "deck"
    scope: Literal["user", "global"] = "user"


@router.get("/categories")
def list_template_categories(user: CurrentUser) -> dict:
    with SessionLocal() as s:
        cats = list_categories(s)
    return {"categories": cats, "total": len(cats)}


@router.post("/categories", status_code=201)
def create_template_category(body: CategoryCreateBody, user: CurrentUser) -> dict:
    if user.role != "admin":
        raise HTTPException(403, "admin required")
    with SessionLocal() as s:
        if s.get(TemplateCategory, body.id):
            raise HTTPException(409, "category id already exists")
        row = TemplateCategory(
            id=body.id,
            name=body.name,
            scope="admin",
            sort_order=body.sort_order,
            created_by=user.id,
        )
        s.add(row)
        s.commit()
        return {
            "category": {
                "id": row.id,
                "name": row.name,
                "scope": row.scope,
                "sort_order": row.sort_order,
            }
        }


@router.patch("/categories/{category_id}")
def patch_template_category(category_id: str, body: CategoryPatchBody, user: CurrentUser) -> dict:
    if user.role != "admin":
        raise HTTPException(403, "admin required")
    with SessionLocal() as s:
        row = s.get(TemplateCategory, category_id)
        if not row:
            raise HTTPException(404, "category not found")
        if row.scope == "system":
            raise HTTPException(403, "cannot edit system category")
        if body.name is not None:
            row.name = body.name
        if body.sort_order is not None:
            row.sort_order = body.sort_order
        s.commit()
        return {
            "category": {
                "id": row.id,
                "name": row.name,
                "scope": row.scope,
                "sort_order": row.sort_order,
            }
        }


@router.delete("/categories/{category_id}")
def delete_template_category(category_id: str, user: CurrentUser) -> dict:
    if user.role != "admin":
        raise HTTPException(403, "admin required")
    with SessionLocal() as s:
        row = s.get(TemplateCategory, category_id)
        if not row:
            raise HTTPException(404, "category not found")
        if row.scope == "system":
            raise HTTPException(403, "cannot delete system category")
        in_use = s.query(Template).filter(Template.category_id == category_id).count()
        if in_use:
            raise HTTPException(409, f"category has {in_use} templates")
        s.delete(row)
        s.commit()
    return {"ok": True}


@router.post("/analyze")
async def analyze_template_pptx(
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".pptx"):
        raise HTTPException(422, "requires .pptx file")
    staging_id = str(uuid.uuid4())
    staging_dir = TEMPLATE_STAGING_DIR / staging_id
    staging_dir.mkdir(parents=True, exist_ok=True)
    dest = staging_dir / safe_stage_name(file.filename)
    size = 0
    with dest.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_PPTX_BYTES:
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "file too large")
            out.write(chunk)
    original_stem = Path(file.filename).stem
    return analyze_pptx(staging_id, dest, display_name_hint=original_stem)


@router.post("/suggest-slug")
def suggest_template_slug(body: SuggestSlugBody, user: CurrentUser) -> dict:
    slug = body.slug.strip().lower()
    if not SLUG_RE.match(slug):
        raise HTTPException(422, "invalid slug")
    if body.scope == "global" and user.role != "admin":
        raise HTTPException(403, "admin required")
    with SessionLocal() as s:
        u = s.get(User, user.id)
        if not u:
            raise HTTPException(401, "user not found")
        owner_id = u.id if body.scope == "user" else None
        unique, deduplicated = suggest_unique_slug(
            s,
            base=slug,
            kind=body.kind,  # type: ignore[arg-type]
            scope=body.scope,  # type: ignore[arg-type]
            owner_id=owner_id,
        )
    return {"slug": unique, "base": slug, "deduplicated": deduplicated}


@router.get("/records/{db_id}/status")
def template_status(db_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        row = s.get(Template, db_id)
        if not row:
            raise HTTPException(404, "template not found")
        if row.scope == "user" and row.owner_user_id != user.id:
            raise HTTPException(404, "template not found")
        job = s.get(Job, row.source_job_id) if row.source_job_id else None
        return {
            "template": template_row_to_entry(row),
            "job_status": job.status if job else None,
            "job_id": row.source_job_id,
        }


@router.patch("/records/{db_id}")
def patch_template(db_id: str, body: TemplatePatchBody, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        row = s.get(Template, db_id)
        if not row:
            raise HTTPException(404, "template not found")
        if row.scope == "system":
            raise HTTPException(403, "cannot edit system template")
        if row.scope == "user" and row.owner_user_id != user.id:
            raise HTTPException(403, "not owner")
        if row.scope == "global" and user.role != "admin":
            raise HTTPException(403, "admin required")
        if body.display_name is not None:
            row.display_name = body.display_name
        if body.category_id is not None:
            row.category_id = body.category_id
        s.commit()
        return {"template": template_row_to_entry(row)}


@router.delete("/records/{db_id}")
def remove_template(db_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        delete_template(s, user, db_id)
    return {"ok": True}


@router.post("/records/{db_id}/retry")
def retry_template_record(db_id: str, user: CurrentUser) -> dict:
    with SessionLocal() as s:
        return retry_template_task(s, user, db_id)


@router.post("/records/{db_id}/publish")
def publish_template_record(db_id: str, user: CurrentUser) -> dict:
    if user.role != "admin":
        raise HTTPException(403, "admin required")
    with SessionLocal() as s:
        row = publish_template(s, db_id)
        return {"template": template_row_to_entry(row)}


@router.post("/fork/{kind}/{slug}")
def fork_template(
    kind: TemplateKindParam,
    slug: str,
    user: CurrentUser,
    new_slug: str | None = Query(default=None),
) -> dict:
    with SessionLocal() as s:
        row = fork_system_template(s, user, kind, slug, new_slug=new_slug)
        return {"template": template_row_to_entry(row)}


@router.post("", status_code=201)
def create_template(body: TemplateBriefBody, user: CurrentUser) -> dict:
    brief = body.model_dump()
    with SessionLocal() as s:
        u = s.get(User, user.id)
        if not u:
            raise HTTPException(401, "user not found")
        if u.quota_credits <= 0:
            raise HTTPException(402, "quota exhausted")
        row = create_template_record(s, u, brief=brief, is_admin=u.role == "admin")
        u.quota_credits -= 1
        job_id = str(uuid.uuid4())
        project_root = project_root_for(u.id, job_id)
        project_root.mkdir(parents=True, exist_ok=True)
        prompt = build_template_create_prompt(
            template_row=row,
            staging_id=body.staging_id,
            project_root=project_root,
            brief=brief,
        )
        from backend.api.schemas.job_options import JobOptions  # noqa: PLC0415

        opts = JobOptions(
            job_type="template_create",
            template_record_id=row.id,
            template_staging_id=body.staging_id,
        )
        s.add(Job(
            id=job_id,
            user_id=u.id,
            prompt=prompt,
            project_name=f"tpl_{row.slug}"[:64],
            status="queued",
            require_confirm=False,
            options_json=json.dumps(opts.model_dump()),
        ))
        row.source_job_id = job_id
        s.commit()
    notify_dispatcher()
    return {
        "template": template_row_to_entry(row),
        "job_id": job_id,
    }


@router.get("/tasks")
def list_template_creation_tasks(user: CurrentUser) -> dict:
    with SessionLocal() as s:
        tasks = list_template_tasks(s, user, is_admin=user.role == "admin")
    return {"tasks": tasks, "total": len(tasks)}


@router.get("")
def list_templates(
    user: CurrentUser,
    kind: TemplateKindParam | None = Query(default=None),
    scope: TemplateScopeParam | None = Query(default=None),
    category: str | None = Query(default=None),
) -> dict:
    with SessionLocal() as s:
        items = list_catalog_entries(
            s, user, category_id=category, kind=kind, scope=scope
        )
    return {"templates": items, "total": len(items)}


@router.get("/{scope}/{kind}/{template_id}/preview/{page}")
def get_template_preview(
    scope: TemplateScopeParam,
    kind: TemplateKindParam,
    template_id: str,
    page: str,
    user: CurrentUser,
) -> FileResponse:
    with SessionLocal() as s:
        get_catalog_entry(s, user, scope, kind, template_id)
    owner_id = user.id if scope == "user" else None
    path = resolve_preview_file(scope, kind, template_id, page, user_id=owner_id)
    return FileResponse(path, media_type="image/svg+xml")


@router.get("/{scope}/{kind}/{template_id}")
def get_template(
    scope: TemplateScopeParam,
    kind: TemplateKindParam,
    template_id: str,
    user: CurrentUser,
) -> dict:
    with SessionLocal() as s:
        return get_catalog_entry(s, user, scope, kind, template_id)
