import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger("backend.api.spa")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
WEBUI_DIST = REPO_ROOT / "webui" / "dist"


def mount_spa(app: FastAPI) -> None:
    if WEBUI_DIST.exists() and (WEBUI_DIST / "index.html").is_file():
        assets_dir = WEBUI_DIST / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir), html=False), name="assets")

        @app.get("/")
        async def index() -> FileResponse:
            return FileResponse(WEBUI_DIST / "index.html", media_type="text/html")

        @app.get("/{full_path:path}")
        async def spa_fallback(full_path: str) -> FileResponse:
            if full_path.startswith("api/"):
                raise HTTPException(404, "not found")
            candidate = WEBUI_DIST / full_path
            if candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(WEBUI_DIST / "index.html", media_type="text/html")
    else:
        log.warning(
            "webui/dist not found at %s — run: cd webui && npm install && npm run build",
            WEBUI_DIST,
        )

        @app.get("/")
        async def root_fallback() -> PlainTextResponse:
            return PlainTextResponse(
                f"webui/dist not found (looked at {WEBUI_DIST}). "
                "Build the frontend first:\n  cd webui && npm install && npm run build\n"
                "API is up — see /docs",
                status_code=200,
            )
