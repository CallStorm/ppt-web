from fastapi import APIRouter

from backend.api.routes import app_llm, auth, health, jobs

router = APIRouter(prefix="/api")
router.include_router(auth.router)
router.include_router(health.router)
router.include_router(jobs.router)
router.include_router(app_llm.router)
