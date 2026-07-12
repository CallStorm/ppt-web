"""Template catalog service — list, analyze, create, CRUD."""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.app.templates import (
    TemplateKind,
    TemplateScope,
    _entry_from_disk_path,
    _entry_from_dir,
    _load_index,
    discover_template_preview_svgs,
    list_system_template_dirs,
    resolve_template_path,
)
from backend.db.session import SessionLocal
from backend.models import Job, Template, TemplateCategory, User
from backend.paths import (
    TEMPLATE_STAGING_DIR,
    global_templates_dir,
    project_root_for,
    user_templates_dir,
)
from backend.runtime.jobs import notify_dispatcher, prepare_job_retry
from backend.runner.constants import PPTMASTER

log = logging.getLogger("backend.app.template_service")

SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
KEYWORD_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
REPLICATION_MODES = frozenset({"standard", "fidelity", "mirror"})
NATIVE_STRUCTURE_MODES = frozenset({"preserve", "template"})
VISUAL_FIDELITIES = frozenset({"literal", "adapted"})
THEME_MODES = frozenset({"light", "dark"})
PPTX_IMPORT = PPTMASTER / "skills" / "ppt-master" / "scripts" / "pptx_template_import.py"

_PRIMARY_COLOR_KEYS = ("accent1", "accent2", "dk1", "lt1", "accent3", "accent4", "accent5", "accent6")


def _hex_colors_from_theme(theme: dict[str, Any] | None) -> list[str]:
    if not theme or not isinstance(theme, dict):
        return []
    colors = theme.get("colors")
    if isinstance(colors, dict):
        out: list[str] = []
        for key in _PRIMARY_COLOR_KEYS:
            val = colors.get(key)
            if isinstance(val, str) and val.startswith("#"):
                out.append(val)
        for val in colors.values():
            if isinstance(val, str) and val.startswith("#") and val not in out:
                out.append(val)
        return out
    if isinstance(colors, list):
        return [c for c in colors if isinstance(c, str) and c.startswith("#")]
    return []


def _fonts_from_theme(theme: dict[str, Any] | None) -> list[str]:
    if not theme or not isinstance(theme, dict):
        return []
    fonts = theme.get("fonts")
    if isinstance(fonts, dict):
        return [str(v) for v in fonts.values() if v]
    if isinstance(fonts, list):
        return [str(f) for f in fonts if f]
    return []


def _slide_dimensions(slide_size: dict[str, Any]) -> tuple[int, int]:
    w = slide_size.get("width_px") or slide_size.get("width") or slide_size.get("cx") or 1280
    h = slide_size.get("height_px") or slide_size.get("height") or slide_size.get("cy") or 720
    try:
        return int(w), int(h)
    except (TypeError, ValueError):
        return 1280, 720


def _page_types_from_manifest(manifest: dict[str, Any], slides: list[Any]) -> list[str]:
    types: list[str] = []
    for slide in slides:
        if not isinstance(slide, dict):
            types.append("content")
            continue
        ptype = slide.get("pageType") or slide.get("pageTypeCandidate") or slide.get("page_type")
        types.append(str(ptype) if ptype else "content")
    if types:
        return types
    page_map = manifest.get("pageTypeCandidates")
    if isinstance(page_map, dict):
        ordered: list[str] = []
        for ptype, indexes in page_map.items():
            if not isinstance(indexes, list):
                continue
            for idx in indexes:
                while len(ordered) <= idx:
                    ordered.append("content")
                if idx < len(ordered):
                    ordered[idx] = str(ptype)
        if ordered:
            return ordered
    return []


def _native_structure_mode(native: dict[str, Any]) -> str:
    strategy = native.get("strategy")
    if isinstance(strategy, dict):
        mode = strategy.get("recommendedMode")
        if mode in ("preserve", "template"):
            return mode
    mode = native.get("recommendedMode")
    if mode in ("preserve", "template"):
        return mode
    return "template"


def parse_manifest_analysis(manifest: dict[str, Any], native: dict[str, Any]) -> dict[str, Any]:
    """Normalize pptx_template_import manifest into wizard-friendly analysis."""
    slide_size = manifest.get("slideSize") or {}
    theme = manifest.get("theme") if isinstance(manifest.get("theme"), dict) else {}
    slides = manifest.get("slides") or []
    if not isinstance(slides, list):
        slides = []

    theme_color_list = _hex_colors_from_theme(theme)
    font_list = _fonts_from_theme(theme)
    w, h = _slide_dimensions(slide_size if isinstance(slide_size, dict) else {})
    aspect = w / h if h else 16 / 9
    if abs(aspect - 16 / 9) < 0.05:
        canvas_format = "ppt169"
    elif abs(aspect - 4 / 3) < 0.05:
        canvas_format = "ppt43"
    else:
        canvas_format = "ppt169"

    source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
    title_guess = str(source.get("name") or "template").replace(".pptx", "").replace("_", " ")

    return {
        "page_count": len(slides) or manifest.get("slideCount") or 0,
        "canvas_format": canvas_format,
        "canvas_width": w,
        "canvas_height": h,
        "canvas_viewbox": f"0 0 {w} {h}",
        "theme_colors": theme_color_list[:6],
        "fonts": font_list[:6],
        "master_count": len(manifest.get("masters") or []),
        "layout_count": len(manifest.get("layouts") or []),
        "page_type_candidates": _page_types_from_manifest(manifest, slides),
        "primary_color": theme_color_list[0] if theme_color_list else None,
        "title_guess": title_guess,
        "native_structure_mode": _native_structure_mode(native),
        "theme_mode": "light",
    }


def category_to_dict(c: TemplateCategory) -> dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "scope": c.scope,
        "sort_order": c.sort_order,
    }


def list_categories(s: Session) -> list[dict[str, Any]]:
    rows = (
        s.query(TemplateCategory)
        .order_by(TemplateCategory.sort_order, TemplateCategory.id)
        .all()
    )
    return [category_to_dict(c) for c in rows]


def template_row_to_entry(row: Template) -> dict[str, Any]:
    page_types: list[str] = []
    try:
        page_types = json.loads(row.page_types_json or "[]")
    except json.JSONDecodeError:
        pass
    template_dir: Path | None = None
    try:
        template_dir = resolve_template_path(
            row.scope, row.kind, row.slug, user_id=row.owner_user_id  # type: ignore[arg-type]
        )
    except HTTPException:
        template_dir = Path(row.storage_path) if row.storage_path else None

    cover_svg = None
    preview_slides: list[str] = []
    if template_dir and template_dir.is_dir():
        from backend.app.templates import _find_cover_svg, _list_svg_previews  # noqa: PLC0415

        cover_svg = _find_cover_svg(template_dir)
        preview_slides = _list_svg_previews(template_dir)

    return {
        "id": row.slug,
        "db_id": row.id,
        "slug": row.slug,
        "display_name": row.display_name or row.slug,
        "scope": row.scope,
        "kind": row.kind,
        "category_id": row.category_id,
        "summary": row.summary or "",
        "canvas_format": row.canvas_format or "ppt169",
        "page_count": row.page_count or len(preview_slides),
        "page_types": page_types,
        "primary_color": row.primary_color,
        "cover_svg": cover_svg,
        "preview_slides": preview_slides,
        "status": row.status,
        "source_job_id": row.source_job_id,
    }


def list_template_tasks(s: Session, user: User, *, is_admin: bool) -> list[dict[str, Any]]:
    """In-progress or failed template records visible to the user."""
    q = s.query(Template).filter(Template.status.in_(["generating", "failed"]))
    if is_admin:
        q = q.filter(
            ((Template.scope == "user") & (Template.owner_user_id == user.id))
            | (Template.scope == "global")
        )
    else:
        q = q.filter(Template.scope == "user", Template.owner_user_id == user.id)

    rows = q.order_by(Template.updated_at.desc()).all()
    tasks: list[dict[str, Any]] = []
    for row in rows:
        job = s.get(Job, row.source_job_id) if row.source_job_id else None
        entry = template_row_to_entry(row)
        entry["job_id"] = row.source_job_id
        entry["job_status"] = job.status if job else None
        entry["error_message"] = job.error_message if job else None
        entry["updated_at"] = row.updated_at.isoformat() if row.updated_at else None
        tasks.append(entry)
    return tasks


def list_catalog_entries(
    s: Session,
    user: User,
    *,
    category_id: str | None = None,
    kind: TemplateKind | None = None,
    scope: TemplateScope | None = None,
    include_non_ready: bool = False,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    if scope in (None, "system"):
        for k, template_dir in list_system_template_dirs():
            if kind and k != kind:
                continue
            row = (
                s.query(Template)
                .filter(Template.scope == "system", Template.kind == k, Template.slug == template_dir.name)
                .first()
            )
            if row:
                entry = template_row_to_entry(row)
            else:
                index = _load_index(k)
                entry = _entry_from_dir(k, template_dir, index)
            if category_id and entry.get("category_id") != category_id:
                continue
            items.append(entry)

    q = s.query(Template).filter(Template.scope.in_(["global", "user"]))
    if not include_non_ready:
        q = q.filter(Template.status == "ready")
    if scope == "global":
        q = q.filter(Template.scope == "global")
    elif scope == "user":
        q = q.filter(Template.scope == "user", Template.owner_user_id == user.id)
    elif scope is None:
        q = q.filter(
            (Template.scope == "global")
            | ((Template.scope == "user") & (Template.owner_user_id == user.id))
        )
    if kind:
        q = q.filter(Template.kind == kind)
    if category_id:
        q = q.filter(Template.category_id == category_id)

    for row in q.all():
        items.append(template_row_to_entry(row))

    items.sort(key=lambda x: (x.get("category_id", ""), x.get("kind", ""), x.get("slug", "")))
    return items


def get_catalog_entry(
    s: Session,
    user: User,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: str,
) -> dict[str, Any]:
    _assert_template_access(s, user, scope, kind, template_id)
    row = (
        s.query(Template)
        .filter(Template.scope == scope, Template.kind == kind, Template.slug == template_id)
        .first()
    )
    if row:
        return template_row_to_entry(row)
    if scope == "system":
        template_dir = resolve_template_path(scope, kind, template_id)
        index = _load_index(kind)
        return _entry_from_dir(kind, template_dir, index)
    raise HTTPException(404, "template not found")


def _assert_template_access(
    s: Session,
    user: User,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: str,
) -> None:
    if scope == "user":
        row = (
            s.query(Template)
            .filter(
                Template.scope == "user",
                Template.kind == kind,
                Template.slug == template_id,
            )
            .first()
        )
        if not row or row.owner_user_id != user.id:
            raise HTTPException(404, "template not found")
        if row.status != "ready":
            raise HTTPException(404, "template not ready")
        return
    if scope == "global":
        row = (
            s.query(Template)
            .filter(
                Template.scope == "global",
                Template.kind == kind,
                Template.slug == template_id,
                Template.status == "ready",
            )
            .first()
        )
        if not row:
            raise HTTPException(404, "template not found")
        return
    resolve_template_path(scope, kind, template_id)


def analyze_pptx(staging_id: str, pptx_path: Path) -> dict[str, Any]:
    if not PPTX_IMPORT.is_file():
        raise HTTPException(500, "pptx_template_import.py not found")
    out_dir = TEMPLATE_STAGING_DIR / staging_id
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "reference.pptx"
    shutil.copy2(pptx_path, dest)

    try:
        proc = subprocess.run(
            ["python3", str(PPTX_IMPORT), str(dest), "-o", str(out_dir)],
            capture_output=True,
            text=True,
            timeout=300,
            cwd=str(PPTMASTER),
        )
    except subprocess.TimeoutExpired as e:
        raise HTTPException(504, "pptx analysis timed out") from e
    if proc.returncode != 0:
        log.error("pptx import failed: %s", proc.stderr[-2000:])
        raise HTTPException(422, f"pptx analysis failed: {proc.stderr[-500:]}")

    manifest_path = out_dir / "manifest.json"
    if not manifest_path.is_file():
        raise HTTPException(422, "manifest.json not produced")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    native = {}
    native_path = out_dir / "native_structure.json"
    if native_path.is_file():
        native = json.loads(native_path.read_text(encoding="utf-8"))

    analysis = parse_manifest_analysis(manifest, native)

    cover_preview: str | None = None
    flat_dir = out_dir / "svg-flat"
    if flat_dir.is_dir():
        flats = sorted(flat_dir.glob("slide_*.svg"))
        if flats:
            cover_preview = flats[0].name
    analysis["cover_preview"] = cover_preview

    title_guess = analysis.pop("title_guess", "template")
    slug_guess = re.sub(r"[^a-z0-9]+", "_", title_guess.lower()).strip("_")[:48] or "my_template"
    if not SLUG_RE.match(slug_guess):
        slug_guess = f"tpl_{uuid.uuid4().hex[:8]}"

    return {
        "staging_id": staging_id,
        "manifest": manifest,
        "native_structure": native,
        "analysis": {
            **analysis,
            "title_guess": title_guess,
            "slug_guess": slug_guess,
        },
    }


def validate_template_brief(brief: dict[str, Any], *, is_admin: bool) -> None:
    display_name = (brief.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(422, "display_name is required")
    if len(display_name) > 128:
        raise HTTPException(422, "display_name must be at most 128 characters")

    slug = (brief.get("slug") or "").strip()
    if not SLUG_RE.match(slug):
        raise HTTPException(422, "slug must be lowercase ASCII slug (a-z, 0-9, _, -)")

    kind = brief.get("kind") or "deck"
    if kind not in ("deck", "layout"):
        raise HTTPException(422, "kind must be deck or layout")

    replication_mode = brief.get("replication_mode") or "standard"
    if replication_mode not in REPLICATION_MODES:
        raise HTTPException(422, "replication_mode must be standard, fidelity, or mirror")

    native_structure_mode = brief.get("native_structure_mode") or "template"
    if native_structure_mode not in NATIVE_STRUCTURE_MODES:
        raise HTTPException(422, "native_structure_mode must be preserve or template")
    if replication_mode == "mirror" and native_structure_mode == "preserve":
        raise HTTPException(422, "mirror mode requires native_structure_mode=template")

    visual_fidelity = brief.get("visual_fidelity") or "literal"
    if visual_fidelity not in VISUAL_FIDELITIES:
        raise HTTPException(422, "visual_fidelity must be literal or adapted")

    theme_mode = brief.get("theme_mode") or "light"
    if theme_mode not in THEME_MODES:
        raise HTTPException(422, "theme_mode must be light or dark")

    primary_color = brief.get("primary_color")
    if primary_color and not HEX_COLOR_RE.match(str(primary_color)):
        raise HTTPException(422, "primary_color must be #RRGGBB hex")

    keywords = brief.get("keywords") or []
    if not isinstance(keywords, list) or not keywords:
        raise HTTPException(422, "keywords must be a non-empty list")
    for kw in keywords:
        if not isinstance(kw, str) or not KEYWORD_RE.match(kw.strip()):
            raise HTTPException(422, "keywords must be lowercase ASCII tokens")

    summary = brief.get("summary") or ""
    if len(summary) > 500:
        raise HTTPException(422, "summary must be at most 500 characters")

    if is_admin and brief.get("scope") == "global" and not (brief.get("category_id") or "").strip():
        raise HTTPException(422, "category_id is required for global templates")


def create_template_record(
    s: Session,
    user: User,
    *,
    brief: dict[str, Any],
    is_admin: bool,
) -> Template:
    validate_template_brief(brief, is_admin=is_admin)
    slug = (brief.get("slug") or "").strip()
    kind = brief.get("kind") or "deck"

    if is_admin and brief.get("scope") == "global":
        scope = "global"
        category_id = brief.get("category_id") or "builtin"
        owner_id = None
        output_dir = global_templates_dir() / slug
    else:
        scope = "user"
        category_id = "my_templates"
        owner_id = user.id
        output_dir = user_templates_dir(user.id) / slug

    cat = s.get(TemplateCategory, category_id)
    if not cat:
        raise HTTPException(422, f"unknown category_id: {category_id}")

    q = s.query(Template).filter(Template.scope == scope, Template.kind == kind, Template.slug == slug)
    if scope == "user":
        q = q.filter(Template.owner_user_id == owner_id)
    dup = q.first()
    if dup:
        raise HTTPException(409, f"template slug already exists: {slug}")

    if output_dir.exists():
        raise HTTPException(409, f"template directory already exists: {slug}")

    row = Template(
        id=str(uuid.uuid4()),
        slug=slug,
        display_name=brief.get("display_name") or slug,
        kind=kind,
        scope=scope,
        owner_user_id=owner_id,
        category_id=category_id,
        status="generating",
        summary=brief.get("summary") or "",
        primary_color=brief.get("primary_color"),
        canvas_format=brief.get("canvas_format") or "ppt169",
        page_count=int(brief.get("page_count") or 0),
        page_types_json=json.dumps(brief.get("keywords") or []),
        storage_path=str(output_dir),
        brief_json=json.dumps(brief, ensure_ascii=False),
    )
    s.add(row)
    s.commit()
    s.refresh(row)
    return row


def mark_template_ready(s: Session, template_id: str, *, job_id: str | None = None) -> None:
    row = s.get(Template, template_id)
    if not row:
        return
    template_dir = Path(row.storage_path)
    if not template_dir.is_dir() or not (template_dir / "design_spec.md").is_file():
        mark_template_failed(s, template_id, "no previewable SVG roster")
        return
    if not discover_template_preview_svgs(template_dir):
        mark_template_failed(s, template_id, "no previewable SVG roster")
        return
    row.status = "ready"
    if job_id:
        row.source_job_id = job_id
    entry = _entry_from_disk_path(
        scope=row.scope,  # type: ignore[arg-type]
        kind=row.kind,  # type: ignore[arg-type]
        slug=row.slug,
        template_dir=template_dir,
        category_id=row.category_id,
        display_name=row.display_name,
        db_id=row.id,
        status="ready",
    )
    row.page_count = entry.get("page_count") or row.page_count
    row.primary_color = entry.get("primary_color") or row.primary_color
    row.summary = entry.get("summary") or row.summary
    s.commit()


def _template_record_id_from_job(job: Job) -> str | None:
    if not job.options_json:
        return None
    from backend.api.schemas.job_options import parse_job_options  # noqa: PLC0415

    opts = parse_job_options(job.options_json)
    if not opts or opts.job_type != "template_create" or not opts.template_record_id:
        return None
    return opts.template_record_id


def _job_is_retryable_terminal(job: Job) -> bool:
    if job.status in ("failed", "cancelled"):
        return True
    return job.status == "paused" and not job.session_id


def _append_failed_summary(summary: str | None, message: str) -> str:
    base = summary or ""
    if " [failed:" in base:
        return base
    return base + f" [failed: {message[:200]}]"


def sync_template_on_job_terminal(
    s: Session,
    job: Job,
    *,
    error_message: str | None = None,
) -> bool:
    """template_create Job 进入 failed/cancelled 时，将 Template 从 generating 标为 failed.

    Returns True if the template row was updated. Does not commit.
    """
    template_id = _template_record_id_from_job(job)
    if not template_id or job.status not in ("failed", "cancelled"):
        return False
    row = s.get(Template, template_id)
    if not row or row.status != "generating":
        return False
    msg = error_message or job.error_message or job.status
    row.status = "failed"
    row.summary = _append_failed_summary(row.summary, str(msg))
    return True


def mark_template_generating(s: Session, template_id: str) -> Template:
    row = s.get(Template, template_id)
    if not row:
        raise HTTPException(404, "template not found")
    row.status = "generating"
    if row.brief_json:
        try:
            brief = json.loads(row.brief_json)
            if brief.get("summary"):
                row.summary = str(brief["summary"])
        except json.JSONDecodeError:
            pass
    elif row.summary and " [failed:" in row.summary:
        row.summary = row.summary.split(" [failed:")[0]
    s.commit()
    s.refresh(row)
    return row


def _clear_template_storage(storage: Path) -> None:
    if not storage.is_dir():
        return
    for child in storage.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            try:
                child.unlink()
            except OSError:
                pass


def retry_template_task(s: Session, user: User, db_id: str) -> dict[str, Any]:
    row = s.get(Template, db_id)
    if not row:
        raise HTTPException(404, "template not found")
    if row.scope == "system":
        raise HTTPException(403, "cannot retry system template")
    if row.scope == "user" and row.owner_user_id != user.id:
        raise HTTPException(403, "not owner")
    if row.scope == "global" and user.role != "admin":
        raise HTTPException(403, "admin required")
    if not row.source_job_id:
        raise HTTPException(409, "template has no linked job to retry")

    job = s.get(Job, row.source_job_id)
    if not job:
        raise HTTPException(404, "linked job not found")

    if row.status == "generating":
        if job.status in ("queued", "running"):
            raise HTTPException(409, "任务进行中，请稍候")
        if _job_is_retryable_terminal(job):
            msg = job.error_message or job.status
            row.status = "failed"
            row.summary = _append_failed_summary(row.summary, str(msg))
            s.commit()
            s.refresh(row)
        else:
            raise HTTPException(
                409,
                f"template status is {row.status}, can only retry failed templates",
            )
    elif row.status != "failed":
        raise HTTPException(409, f"template status is {row.status}, can only retry failed templates")

    if template_output_ready(row.id, None):
        mark_template_ready(s, row.id, job_id=row.source_job_id)
        if job.status in ("failed", "cancelled"):
            job.status = "done"
            job.error_message = None
            s.commit()
        s.refresh(row)
        return {
            "template": template_row_to_entry(row),
            "job_id": job.id,
            "status": "ready",
            "recovered": True,
        }

    owner_id = prepare_job_retry(s, job, user)
    row = mark_template_generating(s, row.id)
    _clear_template_storage(Path(row.storage_path))

    proj = project_root_for(owner_id, job.id)
    if proj.exists():
        shutil.rmtree(proj, ignore_errors=True)

    notify_dispatcher()
    return {
        "template": template_row_to_entry(row),
        "job_id": job.id,
        "status": "queued",
    }


def mark_template_failed(s: Session, template_id: str, message: str) -> None:
    row = s.get(Template, template_id)
    if not row:
        return
    row.status = "failed"
    row.summary = _append_failed_summary(row.summary, message)
    s.commit()


def _collect_template_staging_ids(s: Session, row: Template) -> set[str]:
    ids: set[str] = set()
    if row.brief_json:
        try:
            brief = json.loads(row.brief_json)
            sid = brief.get("staging_id")
            if isinstance(sid, str) and sid:
                ids.add(sid)
        except json.JSONDecodeError:
            pass
    jobs = (
        s.query(Job)
        .filter(Job.options_json.isnot(None))
        .filter(Job.options_json.like(f'%"template_record_id": "{row.id}"%'))
        .all()
    )
    from backend.api.schemas.job_options import parse_job_options  # noqa: PLC0415

    for job in jobs:
        if not job.options_json:
            continue
        opts = parse_job_options(job.options_json)
        if opts and opts.template_staging_id:
            ids.add(opts.template_staging_id)
    return ids


def _remove_staging_dirs(staging_ids: set[str]) -> None:
    for sid in staging_ids:
        staging = TEMPLATE_STAGING_DIR / sid
        if staging.is_dir():
            shutil.rmtree(staging, ignore_errors=True)


def delete_template(s: Session, user: User, db_id: str) -> None:
    row = s.get(Template, db_id)
    if not row:
        raise HTTPException(404, "template not found")
    if row.scope == "system":
        raise HTTPException(403, "cannot delete system template")
    if row.scope == "user" and row.owner_user_id != user.id:
        raise HTTPException(403, "not owner")
    if row.scope == "global" and user.role != "admin":
        raise HTTPException(403, "admin required")
    staging_ids = _collect_template_staging_ids(s, row)
    storage = Path(row.storage_path)
    if storage.is_dir():
        shutil.rmtree(storage, ignore_errors=True)
    _remove_staging_dirs(staging_ids)
    s.delete(row)
    s.commit()


def publish_template(s: Session, db_id: str) -> Template:
    row = s.get(Template, db_id)
    if not row:
        raise HTTPException(404, "template not found")
    if row.scope != "global":
        raise HTTPException(400, "only global templates can be published")
    row.status = "ready"
    s.commit()
    return row


def fork_system_template(
    s: Session,
    user: User,
    kind: TemplateKind,
    slug: str,
    *,
    new_slug: str | None = None,
) -> Template:
    src = resolve_template_path("system", kind, slug)
    dest_slug = new_slug or f"{slug}_copy_{uuid.uuid4().hex[:6]}"
    if not SLUG_RE.match(dest_slug):
        raise HTTPException(422, "invalid new slug")
    dest = user_templates_dir(user.id) / dest_slug
    if dest.exists():
        raise HTTPException(409, "destination already exists")
    shutil.copytree(src, dest)
    entry = _entry_from_disk_path(
        scope="user",
        kind=kind,
        slug=dest_slug,
        template_dir=dest,
        category_id="my_templates",
        display_name=f"{slug} (副本)",
        db_id=str(uuid.uuid4()),
    )
    row = Template(
        id=entry["db_id"],
        slug=dest_slug,
        display_name=entry["display_name"],
        kind=kind,
        scope="user",
        owner_user_id=user.id,
        category_id="my_templates",
        status="ready",
        summary=entry.get("summary") or "",
        primary_color=entry.get("primary_color"),
        canvas_format=entry.get("canvas_format") or "ppt169",
        page_count=entry.get("page_count") or 0,
        page_types_json=json.dumps(entry.get("page_types") or []),
        storage_path=str(dest),
    )
    s.add(row)
    s.commit()
    return row


def template_output_ready(template_record_id: str | None, last_text: str | None = None) -> bool:
    del last_text  # marker alone no longer marks success; files are required
    if not template_record_id:
        return False
    with SessionLocal() as s:
        row = s.get(Template, template_record_id)
        if not row:
            return False
        p = Path(row.storage_path)
        if not (p / "design_spec.md").is_file():
            return False
        return len(discover_template_preview_svgs(p)) > 0


def finalize_template_job(job_id: str, *, success: bool, error_message: str | None = None) -> None:
    with SessionLocal() as s:
        job = s.get(Job, job_id)
        if not job or not job.options_json:
            return
        from backend.api.schemas.job_options import parse_job_options  # noqa: PLC0415

        opts = parse_job_options(job.options_json)
        if not opts or opts.job_type != "template_create" or not opts.template_record_id:
            return
        if success:
            mark_template_ready(s, opts.template_record_id, job_id=job_id)
        else:
            mark_template_failed(s, opts.template_record_id, error_message or "generation failed")


def build_template_create_prompt(
    *,
    template_row: Template,
    staging_id: str,
    project_root: Path,
    brief: dict[str, Any],
) -> str:
    output_dir = Path(template_row.storage_path)
    staging_dir = TEMPLATE_STAGING_DIR / staging_id
    pptx_path = staging_dir / "reference.pptx"
    kind_dir = "decks" if template_row.kind == "deck" else "layouts"

    lines = [
        "请 read_file 读取 skills/ppt-master/workflows/create-template.md，严格按该工作流制作模板。",
        "",
        f"模板输出目录（最终）: {output_dir}",
        f"参考 PPTX: {pptx_path}",
        f"分析工作区: {staging_dir}",
        "",
        "【已确认的 Brief — [TEMPLATE_BRIEF_CONFIRMED]】",
        json.dumps(brief, ensure_ascii=False, indent=2),
        "",
        "【执行要求】",
        f"1. kind={template_row.kind}，template_id/slug={template_row.slug}",
        f"2. 在 {output_dir} 创建完整模板包（design_spec.md + SVG roster + assets）",
        "3. 运行 svg_quality_checker.py --template-mode 校验",
        f"4. 本模板为库资产，目录名必须与 slug 一致",
        "5. 完成后在回复中明确写出 TEMPLATE_CREATE_DONE 和输出目录路径",
        "",
        f"项目暂存目录: {project_root}",
    ]
    return "\n".join(lines)
