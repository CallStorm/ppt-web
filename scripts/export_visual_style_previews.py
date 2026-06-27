#!/usr/bin/env python3
"""Export ppt-master example SVG slides as WebP previews for the visual style gallery.

Reads webui/src/lib/visualStyleCatalog.json and rasterizes svg_final slides to
webui/public/assets/visual-styles/{style-id}/cover.webp, content.webp, closing.webp.

Primary backend: Playwright (Chromium) — required for CJK font fallback.
cairosvg lacks system font chains and renders Chinese as tofu boxes.

Usage:
    python3 scripts/export_visual_style_previews.py

Deps (venv recommended):
    pip install playwright pillow
    python -m playwright install chromium
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPO_ROOT / "webui" / "src" / "lib" / "visualStyleCatalog.json"
PPT_MASTER_EXAMPLES = REPO_ROOT / "ppt-master" / "examples"
OUT_ROOT = REPO_ROOT / "webui" / "public" / "assets" / "visual-styles"
TARGET_SIZE = (640, 360)
VIEWPORT = {"width": 1280, "height": 720}
PREVIEW_KINDS = ("cover", "content", "closing")

# System CJK stacks Chromium should resolve on macOS / Windows.
CJK_FONT_CSS = (
    "PingFang SC, Hiragino Sans GB, Microsoft YaHei, "
    "Noto Sans CJK SC, Source Han Sans SC, sans-serif"
)


def _load_catalog() -> list[dict]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return data["styles"]


def _resolve_svg_path(
    folder: str,
    filename: str,
    example_project_id: str | None,
) -> Path | None:
    """Resolve SVG: svg_final → sibling svg_output → project svg_output."""
    base = PPT_MASTER_EXAMPLES / folder
    candidates: list[Path] = [base / filename]
    if base.name == "svg_final":
        candidates.append(base.parent / "svg_output" / filename)
    if example_project_id:
        candidates.append(
            PPT_MASTER_EXAMPLES / example_project_id / "svg_output" / filename
        )
    for path in candidates:
        if path.is_file():
            return path
    return None


def _svg_html(svg_content: str) -> str:
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<style>"
        "html,body{margin:0;padding:0;background:#0e1116;overflow:hidden}"
        "svg{display:block;width:1280px;height:720px}"
        f"text,tspan{{font-family:{CJK_FONT_CSS} !important}}"
        "</style></head><body>"
        f"{svg_content}</body></html>"
    )


def _file_url(path: Path) -> str:
    return "file://" + quote(path.resolve().as_posix(), safe="/:")


def _render_cairosvg(svg_path: Path, out_path: Path) -> bool:
    """Fallback only — cannot render CJK reliably."""
    try:
        import cairosvg
        from PIL import Image
    except ImportError:
        return False

    try:
        png_bytes = cairosvg.svg2png(
            url=str(svg_path),
            output_width=VIEWPORT["width"],
            output_height=VIEWPORT["height"],
        )
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        img = img.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(out_path, "WEBP", quality=85)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  cairosvg failed for {svg_path.name}: {exc}", file=sys.stderr)
        return False


def _render_playwright(browser, svg_path: Path, out_path: Path) -> bool:
    try:
        from PIL import Image
    except ImportError:
        return False

    context = browser.new_context(
        viewport=VIEWPORT,
        locale="zh-CN",
        device_scale_factor=1,
    )
    page = context.new_page()
    try:
        # file:// loads resolve relative <image href> against the SVG directory.
        page.goto(_file_url(svg_path), wait_until="domcontentloaded")
        page.wait_for_timeout(400)
        png_bytes = page.screenshot(type="png", full_page=False)
    except Exception:
        svg_content = svg_path.read_text(encoding="utf-8")
        page.set_content(_svg_html(svg_content), wait_until="domcontentloaded")
        page.wait_for_timeout(400)
        png_bytes = page.screenshot(type="png", full_page=False)
    finally:
        context.close()

    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    img = img.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "WEBP", quality=85)
    return True


def _render_svg_to_webp(browser, svg_path: Path, out_path: Path) -> bool:
    if browser is not None:
        try:
            if _render_playwright(browser, svg_path, out_path):
                return True
        except Exception as exc:  # noqa: BLE001
            print(f"  playwright failed for {svg_path.name}: {exc}", file=sys.stderr)
    return _render_cairosvg(svg_path, out_path)


def _launch_browser(pw):
    """Prefer bundled Chromium; fall back to system Chrome/Edge for CJK rendering."""
    launchers = [
        lambda: pw.chromium.launch(headless=True),
        lambda: pw.chromium.launch(channel="chrome", headless=True),
        lambda: pw.chromium.launch(channel="msedge", headless=True),
    ]
    last_err: Exception | None = None
    for launch in launchers:
        try:
            return launch()
        except Exception as exc:  # noqa: BLE001
            last_err = exc
    raise RuntimeError(f"no chromium backend available: {last_err}")


def _build_collage(style_ids: list[str], out_path: Path) -> None:
    from PIL import Image

    cells = []
    for sid in style_ids:
        cover = OUT_ROOT / sid / "cover.webp"
        if cover.is_file():
            cells.append(Image.open(cover).convert("RGB"))

    if not cells:
        return

    w, h = TARGET_SIZE
    canvas = Image.new("RGB", (w, h), "#1e293b")
    half_w, half_h = w // 2, h // 2
    positions = [(0, 0), (half_w, 0), (0, half_h), (half_w, half_h)]
    for i, cell in enumerate(cells[:4]):
        thumb = cell.resize((half_w, half_h), Image.Resampling.LANCZOS)
        canvas.paste(thumb, positions[i])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "WEBP", quality=85)


def main() -> int:
    styles = _load_catalog()
    errors: list[str] = []

    browser = None
    pw = None
    try:
        from playwright.sync_api import sync_playwright

        pw = sync_playwright().start()
        browser = _launch_browser(pw)
        print("Using Playwright (Chromium) for CJK-safe rasterization", file=sys.stderr)
    except Exception as exc:
        pw = None
        browser = None
        print(
            f"playwright unavailable ({exc}); falling back to cairosvg "
            "(CJK may show as boxes)",
            file=sys.stderr,
        )

    try:
        for entry in styles:
            style_id = entry["id"]
            if style_id == "auto":
                continue
            folder = entry.get("exampleFolder")
            slides = entry.get("previewSlides")
            project_id = entry.get("exampleProjectId")
            if not folder or not slides:
                errors.append(f"{style_id}: missing folder or slides")
                continue

            for kind in PREVIEW_KINDS:
                filename = slides.get(kind)
                if not filename:
                    errors.append(f"{style_id}: missing previewSlides.{kind}")
                    continue
                svg_path = _resolve_svg_path(folder, filename, project_id)
                if svg_path is None:
                    errors.append(
                        f"{style_id}: missing {filename} (searched svg_final/svg_output)"
                    )
                    continue
                out_path = OUT_ROOT / style_id / f"{kind}.webp"
                print(f"→ {style_id}/{kind}.webp ({svg_path.name})")
                if not _render_svg_to_webp(browser, svg_path, out_path):
                    errors.append(f"{style_id}: render failed {filename}")

        auto_entry = next((s for s in styles if s["id"] == "auto"), None)
        if auto_entry and auto_entry.get("collageStyles"):
            collage_out = OUT_ROOT / "auto" / "collage.webp"
            print("→ auto/collage.webp")
            _build_collage(auto_entry["collageStyles"], collage_out)
    finally:
        if browser is not None:
            browser.close()
        if pw is not None:
            pw.stop()

    if errors:
        print("Warnings:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)

    print(f"Done. Assets under {OUT_ROOT}")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
