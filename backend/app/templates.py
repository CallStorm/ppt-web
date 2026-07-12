"""ppt-master template catalog helpers — system / global / user scopes."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException

from backend.paths import global_templates_dir, user_templates_dir
from backend.runner.constants import PPTMASTER

TemplateKind = Literal["deck", "layout"]
TemplateScope = Literal["system", "global", "user"]

KIND_DIRS: dict[TemplateKind, str] = {
    "deck": "decks",
    "layout": "layouts",
}
CONTAINER_TEMPLATE_ROOT = "/opt/ppt-master/skills/ppt-master/templates"
CONTAINER_GLOBAL_TEMPLATES_ROOT = "/work/global-templates"
CONTAINER_USER_TEMPLATES_PREFIX = "/work/templates"

_HOST_ROOT = PPTMASTER / "skills" / "ppt-master" / "templates"
_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)


def _templates_root() -> Path:
    return _HOST_ROOT


def _kind_dir(kind: TemplateKind) -> Path:
    return _templates_root() / KIND_DIRS[kind]


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


def discover_template_preview_svgs(template_dir: Path) -> list[str]:
    """Discover previewable SVG paths relative to template_dir (root, then subdirs)."""
    if not template_dir.is_dir():
        return []
    seen: set[str] = set()
    result: list[str] = []

    def add(rel: str) -> None:
        if rel not in seen:
            seen.add(rel)
            result.append(rel)

    for path in sorted(template_dir.glob("*.svg")):
        add(path.name)
    flat_dir = template_dir / "svg-flat"
    if flat_dir.is_dir():
        for path in sorted(flat_dir.glob("slide_*.svg")):
            add(f"{flat_dir.name}/{path.name}")
    svg_dir = template_dir / "svg"
    if svg_dir.is_dir():
        for path in sorted(svg_dir.glob("slide_*.svg")):
            add(f"{svg_dir.name}/{path.name}")
    return result


def _find_cover_svg(template_dir: Path) -> str | None:
    slides = discover_template_preview_svgs(template_dir)
    for name in slides:
        base = Path(name).name
        if base == "01_cover.svg" or "_cover" in base:
            return name
    return slides[0] if slides else None


def _list_svg_previews(template_dir: Path) -> list[str]:
    return discover_template_preview_svgs(template_dir)


def _load_index(kind: TemplateKind) -> dict[str, Any]:
    index_path = _kind_dir(kind) / f"{KIND_DIRS[kind]}_index.json"
    if not index_path.is_file():
        return {}
    return json.loads(index_path.read_text(encoding="utf-8"))


def list_system_template_dirs() -> list[tuple[TemplateKind, Path]]:
    hits: list[tuple[TemplateKind, Path]] = []
    for kind in ("deck", "layout"):
        k: TemplateKind = kind  # type: ignore[assignment]
        root = _kind_dir(k)
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir()):
            if child.is_dir() and (child / "design_spec.md").is_file():
                hits.append((k, child))
    return hits


def _entry_from_dir(
    kind: TemplateKind,
    template_dir: Path,
    index: dict[str, Any],
    *,
    scope: TemplateScope = "system",
    category_id: str = "builtin",
    display_name: str | None = None,
    db_id: str | None = None,
) -> dict[str, Any]:
    tid = template_dir.name
    idx = index.get(tid, {})
    spec = _parse_frontmatter(template_dir / "design_spec.md")
    cover = _find_cover_svg(template_dir)
    page_types = idx.get("page_types") or []
    if isinstance(page_types, str):
        page_types = []
    return {
        "id": db_id or tid,
        "slug": tid,
        "display_name": display_name or tid,
        "scope": scope,
        "kind": kind,
        "category_id": category_id,
        "summary": idx.get("summary") or spec.get("summary") or "",
        "canvas_format": idx.get("canvas_format") or spec.get("canvas_format") or "ppt169",
        "page_count": idx.get("page_count") or int(spec.get("page_count") or 0) or len(_list_svg_previews(template_dir)),
        "page_types": page_types if isinstance(page_types, list) else [],
        "primary_color": idx.get("primary_color") or spec.get("primary_color"),
        "cover_svg": cover,
        "preview_slides": _list_svg_previews(template_dir),
        "status": "ready",
    }


def _entry_from_disk_path(
    *,
    scope: TemplateScope,
    kind: TemplateKind,
    slug: str,
    template_dir: Path,
    category_id: str,
    display_name: str,
    db_id: str,
    status: str = "ready",
) -> dict[str, Any]:
    spec = _parse_frontmatter(template_dir / "design_spec.md")
    cover = _find_cover_svg(template_dir)
    page_types_raw = spec.get("page_types") or "[]"
    if isinstance(page_types_raw, str):
        try:
            page_types = json.loads(page_types_raw.replace("'", '"'))
        except json.JSONDecodeError:
            page_types = [p.strip() for p in page_types_raw.strip("[]").split(",") if p.strip()]
    else:
        page_types = page_types_raw if isinstance(page_types_raw, list) else []
    return {
        "id": db_id,
        "slug": slug,
        "display_name": display_name,
        "scope": scope,
        "kind": kind,
        "category_id": category_id,
        "summary": spec.get("summary") or "",
        "canvas_format": spec.get("canvas_format") or "ppt169",
        "page_count": int(spec.get("page_count") or 0) or len(_list_svg_previews(template_dir)),
        "page_types": page_types,
        "primary_color": spec.get("primary_color"),
        "cover_svg": cover,
        "preview_slides": _list_svg_previews(template_dir),
        "status": status,
    }


def resolve_template_path(
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: str,
    *,
    user_id: str | None = None,
) -> Path:
    if not template_id or ".." in template_id or "/" in template_id or "\\" in template_id:
        raise HTTPException(404, "template not found")
    if scope == "system":
        path = _kind_dir(kind) / template_id
    elif scope == "global":
        path = global_templates_dir() / template_id
    elif scope == "user":
        if not user_id:
            raise HTTPException(403, "user template requires owner")
        path = user_templates_dir(user_id) / template_id
    else:
        raise HTTPException(400, "invalid template scope")
    if not path.is_dir() or not (path / "design_spec.md").is_file():
        raise HTTPException(404, "template not found")
    return path


def resolve_container_template_path(
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: str,
    *,
    user_id: str | None = None,
) -> str:
    resolve_template_path(scope, kind, template_id, user_id=user_id)
    if scope == "system":
        sub = KIND_DIRS[kind]
        return f"{CONTAINER_TEMPLATE_ROOT}/{sub}/{template_id}"
    if scope == "global":
        return f"{CONTAINER_GLOBAL_TEMPLATES_ROOT}/{template_id}"
    if scope == "user":
        return f"{CONTAINER_USER_TEMPLATES_PREFIX}/{template_id}"
    raise HTTPException(400, "invalid template scope")


def resolve_preview_file(
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: str,
    page: str,
    *,
    user_id: str | None = None,
) -> Path:
    template_dir = resolve_template_path(scope, kind, template_id, user_id=user_id)
    if not page or ".." in page or page.startswith(("/", "\\")) or "\\" in page:
        raise HTTPException(400, "invalid preview page")
    parts = page.split("/")
    if len(parts) > 2:
        raise HTTPException(400, "invalid preview page")

    basename = Path(page).name
    candidates: list[Path] = []
    if "/" in page:
        candidates.append(template_dir / page)
    candidates.append(template_dir / basename)

    for candidate in candidates:
        if not candidate.is_file() or candidate.suffix.lower() != ".svg":
            continue
        try:
            candidate.resolve().relative_to(template_dir.resolve())
        except ValueError:
            continue
        return candidate

    for rel in discover_template_preview_svgs(template_dir):
        if rel == page or Path(rel).name == basename:
            candidate = template_dir / rel
            if candidate.is_file() and candidate.suffix.lower() == ".svg":
                return candidate

    raise HTTPException(404, "preview not found")


# ── Legacy helpers (backward compat) ─────────────────────────────

@lru_cache(maxsize=1)
def list_global_templates() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for kind, template_dir in list_system_template_dirs():
        index = _load_index(kind)
        items.append(_entry_from_dir(kind, template_dir, index))
    items.sort(key=lambda x: (x["kind"], x["slug"]))
    return items


def get_template_entry(kind: TemplateKind, template_id: str) -> dict[str, Any]:
    template_dir = resolve_global_template_path(kind, template_id)
    index = _load_index(kind)
    return _entry_from_dir(kind, template_dir, index)


def resolve_global_template_path(kind: TemplateKind, template_id: str) -> Path:
    return resolve_template_path("system", kind, template_id)
