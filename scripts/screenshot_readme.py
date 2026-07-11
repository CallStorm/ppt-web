"""Capture README preview screenshots for core WebUI features.

Requires a running server at http://127.0.0.1:8765 with built webui/dist.
Logs in as admin/admin by default.

Usage:
    cd webui && npm run build
    bash scripts/dev-web.sh   # or uvicorn in another terminal
    python3 scripts/screenshot_readme.py

Outputs PNGs to images/preview-*.png.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("PPT_WEB_BASE", "http://127.0.0.1:8765")
OUT = Path(__file__).resolve().parent.parent / "images"
OUT.mkdir(exist_ok=True)

VIEWPORT = {"width": 1440, "height": 900}


def _chromium_executable() -> str | None:
    browsers = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if browsers:
        root = Path(browsers)
        for pattern in (
            "chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
            "chromium-*/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            "chromium-*/chrome-linux/chrome",
            "chromium-*/chrome-win/chrome.exe",
        ):
            matches = sorted(root.glob(pattern))
            if matches:
                return str(matches[-1])
    mac_chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if mac_chrome.is_file():
        return str(mac_chrome)
    win = (
        Path.home()
        / "AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe"
    )
    if win.exists():
        return str(win)
    return None


def _launch_chromium(p):
    exe = _chromium_executable()
    if exe:
        return p.chromium.launch(headless=True, executable_path=exe)
    return p.chromium.launch(headless=True, channel="chrome")


def login(page) -> None:
    page.goto(f"{BASE}/login")
    page.fill('input[type="text"]', "admin")
    page.fill('input[type="password"]', "admin")
    page.locator('form button[type="submit"]').click()
    page.wait_for_url(lambda url: "/login" not in url, timeout=15_000)


def shot(page, name: str) -> None:
    out = OUT / f"{name}.png"
    page.screenshot(path=str(out), full_page=False)
    print(f"  saved {out.relative_to(OUT.parent)} ({out.stat().st_size // 1024}KB)")


def main() -> int:
    with sync_playwright() as p:
        browser = _launch_chromium(p)
        ctx = browser.new_context(viewport=VIEWPORT, locale="zh-CN")
        page = ctx.new_page()
        try:
            print("→ login as admin")
            login(page)

            print("→ / (dashboard)")
            page.goto(f"{BASE}/", wait_until="networkidle")
            page.wait_for_timeout(600)
            shot(page, "preview-dashboard")

            print("→ /chat")
            page.goto(f"{BASE}/chat", wait_until="networkidle")
            page.wait_for_timeout(600)
            shot(page, "preview-chat")

            print("→ /jobs/beautify")
            page.goto(f"{BASE}/jobs/beautify", wait_until="networkidle")
            page.wait_for_timeout(800)
            shot(page, "preview-beautify")

            print("→ /jobs/new")
            page.goto(f"{BASE}/jobs/new", wait_until="networkidle")
            page.wait_for_timeout(600)
            shot(page, "preview-create")

            print("→ / (appearance picker)")
            page.goto(f"{BASE}/", wait_until="networkidle")
            page.wait_for_timeout(400)
            theme_btn = page.locator('button[aria-label="主题设置"]')
            theme_btn.click()
            page.wait_for_timeout(400)
            shot(page, "preview-appearance")

            print("→ /admin")
            page.goto(f"{BASE}/admin", wait_until="networkidle")
            page.wait_for_timeout(800)
            shot(page, "preview-admin")

            return 0
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            try:
                page.screenshot(path=str(OUT / "preview-error.png"))
            except Exception:
                pass
            return 1
        finally:
            ctx.close()
            browser.close()


if __name__ == "__main__":
    sys.exit(main())
