"""Cover preview path resolution for job cards."""
from __future__ import annotations

import re
from pathlib import Path

from backend.runner.svg_finalize import refresh_stale_pages


def _first_svg(svg_dir: Path) -> Path | None:
    if not svg_dir.is_dir():
        return None
    svgs = sorted(svg_dir.glob("*.svg"), key=_slide_sort_key)
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


def _slide_sort_key(p: Path) -> tuple[int, str]:
    """Sort slide files by their leading zero-padded index (e.g. `01_cover.svg`)."""
    m = re.match(r"(\d+)", p.stem)
    return (int(m.group(1)) if m else 9999, p.name)


def list_slides(project_dir: Path | None) -> list[dict]:
    """Ordered per-slide descriptors for a project.

    Each slide prefers a rasterized ``.preview/NN_*.png`` render (produced only by
    the optional visual-review step) and falls back to ``svg_final/NN_*.svg`` —
    the same self-contained SVGs the cover thumbnail already serves.

    If a page in ``svg_output/`` is newer than its counterpart in
    ``svg_final/`` (the common case after a live-preview regen, which only
    re-writes ``svg_output/``), the page is brought up to date in
    ``svg_final/`` on the fly so the preview never shows stale or
    namespace-broken SVGs. The copy is namespace-repaired unconditionally
    (the page that "renders nothing" bug is a wrong xmlns URI on the root).

    Returns a list of dicts: ``{index, name, path, media_type, has_notes,
    notes_path}``, sorted by the leading ``NN`` number.
    """
    if not project_dir or not project_dir.exists():
        return []
    svg_dir = project_dir / "svg_final"
    svg_output_dir = project_dir / "svg_output"
    if not svg_dir.is_dir():
        return []
    refresh_stale_pages(svg_output_dir, svg_dir)

    preview_dir = project_dir / ".preview"
    notes_dir = project_dir / "notes"
    svgs = sorted(svg_dir.glob("*.svg"), key=_slide_sort_key)

    out: list[dict] = []
    for pos, svg in enumerate(svgs, start=1):
        m = re.match(r"(\d+)(?:_(.+))?", svg.stem)
        index = int(m.group(1)) if m else pos
        name = m.group(2) if (m and m.group(2)) else svg.stem

        # Prefer a matching PNG render (zero-padded or bare index).
        chosen = svg
        media_type = "image/svg+xml"
        if preview_dir.is_dir():
            hits = sorted(
                list(preview_dir.glob(f"{index:02d}*.png")) + list(preview_dir.glob(f"{index}*.png")),
                key=_slide_sort_key,
            )
            if hits:
                chosen = hits[0]
                media_type = "image/png"

        notes_path = notes_dir / f"{svg.stem}.md"
        out.append(
            {
                "index": index,
                "name": name,
                "path": chosen,
                "media_type": media_type,
                "has_notes": notes_path.is_file(),
                "notes_path": notes_path if notes_path.is_file() else None,
            }
        )
    return out
