"""Job creation options — validation and prompt formatting."""
from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

Language = Literal["zh", "en", "bilingual"]
Scenario = Literal[
    "general",
    "proposal",
    "product",
    "training",
    "popular_science",
    "speech",
    "project_report",
]
Audience = Literal[
    "general",
    "executive",
    "team",
    "client",
    "expert",
    "student",
]
Tone = Literal["professional", "friendly", "technical", "academic", "concise"]


class JobOptions(BaseModel):
    language: Language = "zh"
    scenario: Scenario = "general"
    audience: Audience = "general"
    tone: Tone = "professional"
    page_count: int = Field(default=5, ge=3, le=30)


DEFAULT_JOB_OPTIONS = JobOptions()

_LANGUAGE: dict[Language, tuple[str, str]] = {
    "zh": ("中文", "正文、标题、图表标注均使用中文"),
    "en": ("English", "slide titles, body text, and chart labels in English"),
    "bilingual": ("中英双语", "标题中英对照，正文以中文为主、关键术语附英文"),
}

_SCENARIO: dict[Scenario, tuple[str, str]] = {
    "general": ("通用", "结构清晰、重点突出，按内容自然组织章节"),
    "proposal": ("方案汇报", "突出问题、解决思路、实施路径与预期收益"),
    "product": ("产品介绍", "突出价值主张、功能亮点、差异化与行动号召"),
    "training": ("培训教程", "循序渐进、步骤清晰，配合示例与要点总结"),
    "popular_science": ("科普宣传", "通俗易懂、类比生动，降低专业门槛"),
    "speech": ("演讲答辩", "开场抓人、论点鲜明、结尾有力，适合口头讲解"),
    "project_report": ("项目汇报", "背景-目标-进展-成果-计划，数据与里程碑并重"),
}

_AUDIENCE: dict[Audience, tuple[str, str]] = {
    "general": ("通用受众", "避免过多行话，兼顾背景与细节"),
    "executive": ("管理层", "结论先行、少细节多洞察，强调决策价值"),
    "team": ("团队内部", "可使用内部术语，侧重协作与执行细节"),
    "client": ("客户/合作方", "避免过多内部术语，强调商业收益与信任"),
    "expert": ("评审专家", "论证严谨、数据充分，回应可能的质疑点"),
    "student": ("学员/学生", "解释充分、举例具体，便于理解与记忆"),
}

_TONE: dict[Tone, tuple[str, str]] = {
    "professional": ("专业严谨", "措辞准确、逻辑清晰、数据支撑"),
    "friendly": ("轻松友好", "语气亲和、易读易懂，避免过于严肃"),
    "technical": ("技术深入", "术语准确、架构/原理讲透，适合技术读者"),
    "academic": ("学术规范", "引用规范、论证完整，适合学术场合"),
    "concise": ("简洁凝练", "每页信息密度高、删繁就简，适合时间有限的汇报"),
}


def parse_job_options(raw: str | None) -> JobOptions | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return JobOptions.model_validate(data)
    except (json.JSONDecodeError, ValidationError):
        return None


def job_options_from_form(
    *,
    language: str = "zh",
    scenario: str = "general",
    audience: str = "general",
    tone: str = "professional",
    page_count: int = 5,
) -> JobOptions:
    return JobOptions(
        language=language,
        scenario=scenario,
        audience=audience,
        tone=tone,
        page_count=page_count,
    )


def format_options_for_prompt(opts: JobOptions) -> str:
    lang_label, lang_hint = _LANGUAGE[opts.language]
    scen_label, scen_hint = _SCENARIO[opts.scenario]
    aud_label, aud_hint = _AUDIENCE[opts.audience]
    tone_label, tone_hint = _TONE[opts.tone]
    lines = [
        "PPT 生成要求（请严格遵循）：",
        f"- 语言：{lang_label}（{lang_hint}）",
        f"- 场景：{scen_label}（{scen_hint}）",
        f"- 目标受众：{aud_label}（{aud_hint}）",
        f"- 语调：{tone_label}（{tone_hint}）",
        f"- 目标页数：约 {opts.page_count} 页（可在 ±1 页内微调以适配内容，但不要明显超出）",
    ]
    return "\n".join(lines)
