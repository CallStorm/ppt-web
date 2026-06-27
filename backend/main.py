"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, TimeoutError as SATimeoutError

from backend.admin import router as admin_router
from backend.api.router import router as api_router
from backend.api.routes.spa import mount_spa
from backend.bootstrap import seed_default_admin
from backend.db.migrations import (
    migrate_v1_to_v2,
    migrate_v2_to_v3,
    migrate_v3_to_v4,
    migrate_v4_to_v5,
    migrate_v5_to_v6,
    migrate_v6_to_v7,
)
from backend.db.session import init_db
from backend.paths import DATA_DIR
from backend.runner.docker import check_docker_runner_ready
from backend.runtime import (
    cleanup_stuck_jobs,
    init_runtime,
    start_dispatcher,
    start_watchdog,
    stop_dispatcher,
    stop_watchdog,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("backend.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if migrate_v1_to_v2():
        log.warning("backend migrate_v1_to_v2 done; old jobs.db dropped")
    if migrate_v2_to_v3():
        log.warning("backend migrate_v2_to_v3 done; added jobs.require_confirm")
    if migrate_v3_to_v4():
        log.warning("backend migrate_v3_to_v4 done; added jobs.pending_confirm")
    if migrate_v4_to_v5():
        log.warning("backend migrate_v4_to_v5 done; added app_config + admin_action_logs")
    if migrate_v5_to_v6():
        log.warning("backend migrate_v5_to_v6 done; added jobs.options_json")
    if migrate_v6_to_v7():
        log.warning("backend migrate_v6_to_v7 done; added jobs.revision_of_job_id")
    init_db()
    seed_default_admin()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    init_runtime()
    n = cleanup_stuck_jobs()
    if n:
        log.warning(f"cleaned up {n} stuck job(s) from previous run")
    docker_err = check_docker_runner_ready()
    if docker_err:
        log.error("Docker runner not ready: %s", docker_err)
    start_dispatcher()
    start_watchdog()
    log.info("backend server ready")
    yield
    await stop_watchdog()
    await stop_dispatcher()
    log.info("backend server shutting down")


def create_app() -> FastAPI:
    app = FastAPI(title="ppt-web MVP", lifespan=lifespan)

    @app.exception_handler(OperationalError)
    @app.exception_handler(SATimeoutError)
    async def db_busy_handler(request: Request, exc: Exception):
        from backend.db.session import pool_status

        log.warning(
            "database busy on %s: %s pool=%s",
            request.url.path,
            exc,
            pool_status(),
        )
        return JSONResponse(
            status_code=503,
            content={"detail": "database busy, retry shortly"},
            headers={"Retry-After": "1"},
        )

    app.include_router(api_router)
    app.include_router(admin_router, prefix="/api/admin")
    mount_spa(app)
    return app


app = create_app()
