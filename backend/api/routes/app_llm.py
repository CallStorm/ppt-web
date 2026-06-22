"""应用级 LLM 端点：optimize-prompt / generate-outline / suggest-style。

调用 backend.app.llm，模型来自 admin 应用设置。无默认模型时返回 503。
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app import llm
from backend.auth.deps import CurrentUser

log = logging.getLogger("backend.api.app_llm")

router = APIRouter(prefix="/app/llm", tags=["app-llm"])


# ── 入参 schemas ────────────────────────────────────────

class _Lang(BaseModel):
    language: str = "zh"


class OptimizePromptBody(_Lang):
    core_topic: str = Field(min_length=1, max_length=2000)
    scenario: str = "general"
    audience: str = "general"
    tone: str = "professional"


class GenerateOutlineBody(_Lang):
    core_topic: str = Field(min_length=1, max_length=2000)
    page_count: int = Field(ge=3, le=30, default=5)
    scenario: str = "general"
    audience: str = "general"


class SuggestStyleBody(BaseModel):
    core_topic: str = Field(min_length=1, max_length=2000)
    scenario: str = "general"
    audience: str = "general"
    tone: str = "professional"


# ── 错误映射 ────────────────────────────────────────────

_CODE_TO_STATUS = {
    "no_default_model": 503,
    "default_disabled": 503,
    "no_api_key": 503,
    "unsupported_protocol": 501,
    "auth_error": 502,
    "upstream_4xx": 502,
    "upstream_5xx": 502,
    "network_error": 502,
    "parse_error": 502,
}


def _raise(e: llm.LlmError) -> None:
    status_code = _CODE_TO_STATUS.get(e.code, 500)
    raise HTTPException(
        status_code=status_code,
        detail={"code": e.code, "message": str(e), "upstream_status": e.upstream_status},
    )


# ── 端点 ────────────────────────────────────────────────

@router.post("/optimize-prompt")
async def post_optimize_prompt(body: OptimizePromptBody, user: CurrentUser) -> dict:
    try:
        data, info = llm.optimize_prompt(
            core_topic=body.core_topic,
            scenario=body.scenario,
            audience=body.audience,
            tone=body.tone,
            language=body.language,
        )
    except llm.LlmError as e:
        _raise(e)
    return {**data, "model_used": info}


@router.post("/generate-outline")
async def post_generate_outline(body: GenerateOutlineBody, user: CurrentUser) -> dict:
    try:
        data, info = llm.generate_outline(
            core_topic=body.core_topic,
            page_count=body.page_count,
            scenario=body.scenario,
            audience=body.audience,
            language=body.language,
        )
    except llm.LlmError as e:
        _raise(e)
    return {**data, "model_used": info}


@router.post("/suggest-style")
async def post_suggest_style(body: SuggestStyleBody, user: CurrentUser) -> dict:
    try:
        data, info = llm.suggest_style(
            core_topic=body.core_topic,
            scenario=body.scenario,
            audience=body.audience,
            tone=body.tone,
        )
    except llm.LlmError as e:
        _raise(e)
    return {**data, "model_used": info}


@router.get("/default-model")
async def get_default_model_info(user: CurrentUser) -> dict:
    """供前端在创建页头部显示「当前模型：xxx」标签，不调上游。"""
    try:
        model, _ = llm.get_default_model()
        return {
            "configured": True,
            "id": model["id"],
            "name": model.get("name") or model["id"],
            "provider": model.get("provider") or "",
            "model": model.get("model") or "",
        }
    except llm.LlmError as e:
        # 前端据此决定是否显示「未配置」灰色标签
        return {"configured": False, "code": e.code, "message": str(e)}
