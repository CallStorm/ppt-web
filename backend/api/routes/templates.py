"""Template catalog API — built-in ppt-master decks/layouts."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from backend.app.templates import (
    get_template_entry,
    list_global_templates,
    resolve_preview_file,
)

router = APIRouter(prefix="/templates", tags=["templates"])

TemplateKindParam = Literal["deck", "layout"]


@router.get("")
def list_templates(
    kind: TemplateKindParam | None = Query(default=None),
) -> dict:
    items = list_global_templates()
    if kind:
        items = [t for t in items if t["kind"] == kind]
    return {"templates": items, "total": len(items)}


@router.get("/{kind}/{template_id}")
def get_template(kind: TemplateKindParam, template_id: str) -> dict:
    return get_template_entry(kind, template_id)


@router.get("/{kind}/{template_id}/preview/{page}")
def get_template_preview(kind: TemplateKindParam, template_id: str, page: str) -> FileResponse:
    path = resolve_preview_file(kind, template_id, page)
    return FileResponse(path, media_type="image/svg+xml")
