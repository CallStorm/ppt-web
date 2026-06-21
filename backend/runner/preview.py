"""Cover preview path resolution for job cards."""
from __future__ import annotations

from pathlib import Path


def _first_svg(svg_dir: Path) -> Path | None:
    if not svg_dir.is_dir():
        return None
    svgs = sorted(svg_dir.glob("*.svg"))
    return svgs[0] if svgs else None


def find_cover_preview(project_dir: Path | None) -> Path | None:
    """Return the best available cover preview file under a project directory."""
    if not project_dir or not project_dir.exists():
        return None

    preview_png = project_dir / ".preview" / "01_cover.png"
    if preview_png.is_file():
        return preview_png

    preview_dir = project_dir / ".preview"
    if preview_dir.is_dir():
        cover_hits = sorted(preview_dir.glob("*cover*.png"))
        if cover_hits:
            return cover_hits[0]

    cover_final = project_dir / "svg_final" / "01_cover.svg"
    if cover_final.is_file():
        return cover_final

    cover_svg = project_dir / "svg_output" / "01_cover.svg"
    if cover_svg.is_file():
        return cover_svg

    hit = _first_svg(project_dir / "svg_final")
    if hit:
        return hit

    return _first_svg(project_dir / "svg_output")
