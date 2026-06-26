"""Parse project spec_lock.md for edit-targets and global revision UI."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from backend.api.schemas.job_options import SPEC_COLOR_KEYS

_LOCK_LINE_RE = re.compile(r"^-\s+([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$")


def parse_lock(lock_path: Path) -> dict[str, dict[str, str]]:
    """Return {section_name: {key: value}} parsed from spec_lock.md."""
    sections: dict[str, dict[str, str]] = {}
    current: str | None = None
    for raw in lock_path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if line.startswith("## "):
            current = line[3:].strip()
            sections.setdefault(current, {})
            continue
        if current is None:
            continue
        m = _LOCK_LINE_RE.match(line)
        if m:
            sections[current][m.group(1)] = m.group(2)
    return sections


def build_spec_summary(project_dir: Path, page_count: int) -> dict[str, Any] | None:
    """Build a frontend-friendly summary from spec_lock.md, if present."""
    lock_path = project_dir / "spec_lock.md"
    if not lock_path.is_file():
        return None
    try:
        sections = parse_lock(lock_path)
    except OSError:
        return None

    colors_raw = sections.get("colors", {})
    colors: dict[str, str] = {}
    for key in SPEC_COLOR_KEYS:
        val = colors_raw.get(key, "")
        if val and val != "#......" and HEX_OK(val):
            colors[key] = val

    typo_raw = sections.get("typography", {})
    typography: dict[str, str] = {}
    for key in ("font_family", "body", "title", "subtitle", "annotation"):
        if typo_raw.get(key):
            typography[key] = typo_raw[key]

    visual_style = sections.get("visual_style", {}).get("visual_style", "")

    return {
        "visual_style": visual_style or None,
        "colors": colors,
        "typography": typography,
        "page_count": page_count,
        "has_spec_lock": True,
    }


def HEX_OK(val: str) -> bool:
    return bool(re.match(r"^#[0-9A-Fa-f]{6}$", val))
