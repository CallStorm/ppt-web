"""Capture screenshots of the Edit/Revision feature for the README.

Requires a running dev server at http://127.0.0.1:8765 with a "done"
job that has at least one revision (so the version history is visible
in the detail page). Logs in as admin/admin by default.

Usage:
    python3 scripts/screenshot_revisions.py

Outputs PNGs to images/edit-*.png and images/revisions-*.png.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765"
OUT = Path(__file__).resolve().parent.parent / "images"
OUT.mkdir(exist_ok=True)

# The Playwright Python wheel we have is newer than the chromium build
# cached in ~/.cache/ms-playwright (it asks for chromium-1223, we have
# -1208). Point it at the existing headless-shell binary instead of
# running `playwright install` (which would re-download hundreds of MB).
CHROMIUM_EXE = (
    Path.home()
    / "AppData"
    / "Local"
    / "ms-playwright"
    / "chromium-1208"
    / "chrome-win64"
    / "chrome.exe"
)

# Job we know has a real revision chain (0a963318… is a revision of
# 81ee3e00…). Falls back to whatever done job exists with the newest
# revision_of_job_id link.
DONE_JOB_WITH_REVISIONS = "81ee3e00-ec2a-42c9-909f-a89990c22812"
LATEST_REVISION = "0a963318-1de2-4474-b6af-ad8accd42ab5"

VIEWPORT = {"width": 1440, "height": 900}


def login(page) -> None:
    page.goto(f"{BASE}/login")
    # Login form uses type="text" for the email/username field; the
    # password input is type="password". Both are visible to the user
    # as a generic credentials form.
    page.fill('input[type="text"]', "admin")
    page.fill('input[type="password"]', "admin")
    page.locator('form button[type="submit"]').click()
    page.wait_for_url(lambda url: "/login" not in url, timeout=10_000)


def shot(page, name: str) -> None:
    out = OUT / f"{name}.png"
    page.screenshot(path=str(out), full_page=False)
    print(f"  saved {out.relative_to(OUT.parent)} ({out.stat().st_size // 1024}KB)")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=str(CHROMIUM_EXE) if CHROMIUM_EXE.exists() else None,
        )
        ctx = browser.new_context(viewport=VIEWPORT, locale="zh-CN")
        page = ctx.new_page()
        try:
            print("→ login as admin")
            login(page)

            # 1. Dashboard — list view, with the done cards visible
            print("→ /  (dashboard)")
            page.goto(f"{BASE}/", wait_until="networkidle")
            page.wait_for_timeout(400)
            shot(page, "edit-01-dashboard")

            # 2. Edit page for the job with revisions
            print(f"→ /jobs/{DONE_JOB_WITH_REVISIONS}/edit")
            page.goto(
                f"{BASE}/jobs/{DONE_JOB_WITH_REVISIONS}/edit",
                wait_until="networkidle",
            )
            # Wait for the slide grid to populate.
            page.wait_for_selector("textarea", timeout=10_000)
            page.wait_for_timeout(800)
            # Fill two example comments so the screenshot shows the form
            # in its intended use, not a blank template.
            tas = page.locator("textarea")
            n = tas.count()
            if n >= 2:
                tas.nth(0).fill("把这个封面标题再放大一点，副标题加一行")
                tas.nth(1).fill("右上角图标换成更稳重的几何形")
            page.wait_for_timeout(200)
            # Tick the confirmation box and scroll to the bottom so the
            # sticky footer is visible.
            page.locator('input[type="checkbox"]').check()
            page.wait_for_timeout(200)
            shot(page, "edit-02-edit-page")

            # 3. Job detail with version history (for the parent job)
            print(f"→ /jobs/{DONE_JOB_WITH_REVISIONS}  (version history)")
            page.goto(
                f"{BASE}/jobs/{DONE_JOB_WITH_REVISIONS}",
                wait_until="networkidle",
            )
            page.wait_for_timeout(500)
            # Scroll down to the version history section.
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(400)
            shot(page, "revisions-03-job-detail")

            # 4. Job detail for the latest revision (so readers see the
            #    "this is the new version" perspective)
            print(f"→ /jobs/{LATEST_REVISION}  (latest revision)")
            page.goto(
                f"{BASE}/jobs/{LATEST_REVISION}",
                wait_until="networkidle",
            )
            page.wait_for_timeout(500)
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(400)
            shot(page, "revisions-04-latest-revision")

            return 0
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            try:
                page.screenshot(path=str(OUT / "error.png"))
            except Exception:
                pass
            return 1
        finally:
            ctx.close()
            browser.close()


if __name__ == "__main__":
    sys.exit(main())
