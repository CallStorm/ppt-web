"""Built-in ppt-master template catalog helpers."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException

from backend.runner.constants import PPTMASTER

TemplateKind = Literal["deck", "layout"]
KIND_DIRS: dict[TemplateKind, str] = {
    "deck": "decks",
    "layout": "layouts",
}
CONTAINER_TEMPLATE_ROOT = "/opt/ppt-master/skills/ppt-master/templates"
_HOST_ROOT = PPTMASTER / "skills" / "ppt-master" / "templates"

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)


def _templates_root() -> Path:
    return _HOST_ROOT


def _kind_dir(kind: TemplateKind) -> Path:
    sub = KIND_DIRS[kind]
    return _templates_root() / sub


def _parse_frontmatter(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    text = path.read_text(encoding="utf-8", errors="replace")
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}
    meta: dict[str, Any] = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            meta[key] = val
    return meta


def _find_cover_svg(template_dir: Path) -> str | None:
    preferred = template_dir / "01_cover.svg"
    if preferred.is_file():
        return preferred.name
    svgs = sorted(template_dir.glob("*.svg"))
    return svgs[0].name if svgs else None


def _list_svg_previews(template_dir: Path) -> list[str]:
    return sorted(p.name for p in template_dir.glob("*.svg"))


def _load_index(kind: TemplateKind) -> dict[str, Any]:
    index_path = _kind_dir(kind) / f"{KIND_DIRS[kind]}_index.json"
    if not index_path.is_file():
        return {}
    return json.loads(index_path.read_text(encoding="utf-8"))


def _discover_template_dirs(kind: TemplateKind) -> list[Path]:
    root = _kind_dir(kind)
    if not root.is_dir():
        return []
    hits: list[Path] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        if (child / "design_spec.md").is_file():
            hits.append(child)
    return hits


def _entry_from_dir(kind: TemplateKind, template_dir: Path, index: dict[str, Any]) -> dict[str, Any]:
    tid = template_dir.name
    idx = index.get(tid, {})
    spec = _parse_frontmatter(template_dir / "design_spec.md")
    cover = _find_cover_svg(template_dir)
    return {
        "scope": "global",
        "kind": kind,
        "id": tid,
        "summary": idx.get("summary") or spec.get("summary") or "",
        "canvas_format": idx.get("canvas_format") or spec.get("canvas_format") or "ppt169",
        "page_count": idx.get("page_count") or int(spec.get("page_count") or 0) or len(_list_svg_previews(template_dir)),
        "page_types": idx.get("page_types") or [],
        "primary_color": idx.get("primary_color") or spec.get("primary_color"),
        "cover_svg": cover,
        "preview_slides": _list_svg_previews(template_dir),
    }


@lru_cache(maxsize=1)
def list_global_templates() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for kind in ("deck", "layout"):
        k: TemplateKind = kind  # type: ignore[assignment]
        index = _load_index(k)
        for template_dir in _discover_template_dirs(k):
            items.append(_entry_from_dir(k, template_dir, index))
    items.sort(key=lambda x: (x["kind"], x["id"]))
    return items


def get_template_entry(kind: TemplateKind, template_id: str) -> dict[str, Any]:
    template_dir = resolve_global_template_path(kind, template_id)
    index = _load_index(kind)
    return _entry_from_dir(kind, template_dir, index)


def resolve_global_template_path(kind: TemplateKind, template_id: str) -> Path:
    if not template_id or ".." in template_id or "/" in template_id or "\\" in template_id:
        raise HTTPException(404, "template not found")
    path = _kind_dir(kind) / template_id
    if not path.is_dir() or not (path / "design_spec.md").is_file():
        raise HTTPException(404, "template not found")
    return path


def resolve_container_template_path(kind: TemplateKind, template_id: str) -> str:
    resolve_global_template_path(kind, template_id)
    sub = KIND_DIRS[kind]
    return f"{CONTAINER_TEMPLATE_ROOT}/{sub}/{template_id}"


def resolve_preview_file(kind: TemplateKind, template_id: str, page: str) -> Path:
    template_dir = resolve_global_template_path(kind, template_id)
    safe = Path(page).name
    if safe != page or ".." in page:
        raise HTTPException(400, "invalid preview page")
    candidate = template_dir / safe
    if not candidate.is_file() or candidate.suffix.lower() != ".svg":
        raise HTTPException(404, "preview not found")
    return candidate
