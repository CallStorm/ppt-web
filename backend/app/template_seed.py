"""Seed system template categories and sync builtin ppt-master templates into DB."""
from __future__ import annotations

import json
import logging

from backend.app.templates import list_system_template_dirs
from backend.db.session import SessionLocal
from backend.models import Template, TemplateCategory

log = logging.getLogger("backend.app.template_seed")

SYSTEM_CATEGORIES = (
    ("builtin", "系统内置", 0),
    ("my_templates", "我的模板", 999),
)


def seed_template_catalog() -> None:
    with SessionLocal() as s:
        for cid, name, order in SYSTEM_CATEGORIES:
            row = s.get(TemplateCategory, cid)
            if not row:
                s.add(TemplateCategory(
                    id=cid,
                    name=name,
                    scope="system",
                    sort_order=order,
                    created_by=None,
                ))
        s.commit()

        builtin_count = 0
        for kind, template_dir in list_system_template_dirs():
            slug = template_dir.name
            existing = (
                s.query(Template)
                .filter(
                    Template.scope == "system",
                    Template.kind == kind,
                    Template.slug == slug,
                )
                .first()
            )
            from backend.app.templates import _entry_from_dir  # noqa: PLC0415

            index = {}
            entry = _entry_from_dir(kind, template_dir, index)
            if existing:
                existing.display_name = slug
                existing.summary = entry.get("summary") or ""
                existing.primary_color = entry.get("primary_color")
                existing.canvas_format = entry.get("canvas_format") or "ppt169"
                existing.page_count = int(entry.get("page_count") or 0)
                existing.page_types_json = json.dumps(entry.get("page_types") or [])
                existing.storage_path = str(template_dir)
                existing.status = "ready"
            else:
                s.add(Template(
                    id=f"sys-{kind}-{slug}",
                    slug=slug,
                    display_name=slug,
                    kind=kind,
                    scope="system",
                    owner_user_id=None,
                    category_id="builtin",
                    status="ready",
                    summary=entry.get("summary") or "",
                    primary_color=entry.get("primary_color"),
                    canvas_format=entry.get("canvas_format") or "ppt169",
                    page_count=int(entry.get("page_count") or 0),
                    page_types_json=json.dumps(entry.get("page_types") or []),
                    storage_path=str(template_dir),
                ))
                builtin_count += 1
        s.commit()
        if builtin_count:
            log.info("seeded %d system templates", builtin_count)
