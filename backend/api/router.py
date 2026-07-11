from fastapi import APIRouter

from backend.api.routes import app_llm, auth, conversations, health, jobs, templates

router = APIRouter(prefix="/api")
router.include_router(auth.router)
router.include_router(health.router)
router.include_router(jobs.router)
router.include_router(templates.router)
router.include_router(app_llm.router)
router.include_router(conversations.router)
