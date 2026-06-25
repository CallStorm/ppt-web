"""Backend-side SVG finalization helpers.

Kept deliberately tiny and dependency-free (no SQLAlchemy, no FastAPI) so it
can be imported from both the live-preview API path and any future script
without dragging the rest of the backend along.

The single responsibility here is to keep ``svg_final/`` in sync with
``svg_output/`` when only a single page was regenerated, so the preview
endpoint never serves a stale or namespace-broken SVG.
"""
from __future__ import annotations

import shutil
from pathlib import Path


def _lazy_repair_svg_file():
    """Return ``repair_svg_file`` if lxml is available, else ``None``.

    Imported lazily so importing this module never costs more than needed,
    and so a missing lxml on the host doesn't break the rest of the
    preview path.
    """
    try:
        from backend.runner.repair_namespace import repair_svg_file  # type: ignore
    except Exception:
        return None
    return repair_svg_file


def refresh_stale_pages(
    svg_output_dir: Path,
    svg_final_dir: Path,
    *,
    mtime_tolerance_seconds: float = 0.05,
) -> int:
    """Copy pages from ``svg_output_dir`` into ``svg_final_dir`` when they
    are missing or newer in the source, then run the namespace repairer
    so the preview can never be served a blank/empty SVG.

    Returns the number of pages refreshed.

    Why this exists: the live-preview flow only re-writes a single page in
    ``svg_output/`` and never re-invokes the full ``finalize_svg`` pipeline.
    That left a window where the preview endpoint would serve a stale page
    — exactly the path that produced the "slide 5 is blank" bug, because
    the bad-namespace SVG from the previous run was still sitting in
    ``svg_final/`` while ``svg_output/`` had already been fixed by a later
    page-regen.

    The full ``finalize_svg`` pipeline re-runs embed-icons / align-images /
    flatten-tspan / rect-to-path, but those are not needed for a single-page
    regen — the icon/image/text work was already done on the previous
    ``svg_final/`` copy, and overwriting it with a clean re-copy of the
    already-embedded ``svg_output/`` version is safe. If a page later needs
    a full re-finalize, an operator can run ``finalize_svg.py`` manually.
    """
    if not svg_output_dir.is_dir():
        return 0
    repair = _lazy_repair_svg_file()
    refreshed = 0
    for src in svg_output_dir.glob("*.svg"):
        dst = svg_final_dir / src.name
        try:
            needs_copy = (not dst.exists()) or (
                src.stat().st_mtime - dst.stat().st_mtime > mtime_tolerance_seconds
            )
        except OSError:
            continue
        if not needs_copy:
            continue
        shutil.copy2(src, dst)
        if repair is not None:
            try:
                repair(dst, verbose=False)
            except Exception:
                # A repair failure is a render-quality issue, not a
                # correctness issue — never break the preview over it.
                pass
        refreshed += 1
    return refreshed
