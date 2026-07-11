"""对话式 PPT 创作编排：多轮规划 + 阶段门控。

App LLM 只负责规划对话；真正生成仍走 ppt-master Job 管线。
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from copy import deepcopy
from typing import Any

from backend.app import llm

log = logging.getLogger("backend.app.chat_orchestrator")

PHASES = ("intake", "requirements", "outline", "style", "generating", "done")

_GENERATE_RE = re.compile(
    r"(生成|开始制作|就按这个|确认生成|开始吧|go|generate|开始生成)",
    re.I,
)
_TEMPLATE_RE = re.compile(r"(模板|template|换模板|看看模板)", re.I)
_OUTLINE_RE = re.compile(r"(大纲|outline|加一页|删一页|改大纲|章节)", re.I)
_STYLE_RE = re.compile(r"(风格|配色|style|换风格)", re.I)

SYSTEM_PLANNER = """你是 PPT 对话创作助手（规划层，不负责真正生成幻灯片）。

根据当前 draft 状态与用户最新消息，输出 JSON（不要 markdown 围栏）：
{
  "reply": "自然语言回复（中文，简洁友好）",
  "draft_patch": { ...可选，深度合并到 draft ... },
  "widgets": [
    { "type": "requirement_form" },
    { "type": "outline_board", "editable": true },
    { "type": "style_picker" },
    { "type": "template_gallery" },
    { "type": "plan_summary", "can_generate": true/false }
  ],
  "intent": "clarify|fill_requirements|revise_outline|revise_style|show_templates|ready",
  "next_phase": "requirements|outline|style|generating"
}

阶段门控（必须遵守）：
- intake：用户刚给主题，next_phase=requirements，widgets 含 requirement_form
- requirements：需求单填完后 next_phase=outline，widgets 含 outline_board
- outline：大纲确认后 next_phase=style，widgets 含 style_picker
- style：风格选定后可含 plan_summary（can_generate=true 当 draft 完整）
- 用户明确说「生成/开始」且 draft 完整 → intent=ready，widgets 含 plan_summary can_generate=true

draft_patch 可含：core_topic, requirements, outline, key_points, options, template, phase_completed。
outline 格式：[{"id":"p1","title":"...","bullets":["..."]}]
options 含 language/scenario/audience/tone/page_count/visual_style/color_mode 等。
requirements 含 page_count/scenario/need_images/dynamic_answers/extra_notes。"""


def empty_draft() -> dict:
    return {
        "core_topic": "",
        "requirements": {
            "page_count": 10,
            "scenario": "general",
            "need_images": True,
            "dynamic_answers": [],
            "extra_notes": "",
        },
        "outline": [],
        "key_points": [],
        "options": {
            "language": "zh",
            "scenario": "general",
            "audience": "general",
            "tone": "professional",
            "page_count": 10,
            "canvas": "ppt169",
            "mode": "briefing",
            "visual_style": None,
            "color_mode": "auto",
            "image_strategy": "web",
        },
        "template": None,
        "uploads": [],
        "phase_completed": {
            "requirements": False,
            "outline": False,
            "style": False,
        },
    }


def parse_draft(raw: str | None) -> dict:
    if not raw:
        return empty_draft()
    try:
        d = json.loads(raw)
        if isinstance(d, dict):
            base = empty_draft()
            _deep_merge(base, d)
            return base
    except json.JSONDecodeError:
        pass
    return empty_draft()


def _deep_merge(base: dict, patch: dict) -> None:
    for k, v in patch.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def dump_draft(draft: dict) -> str:
    return json.dumps(draft, ensure_ascii=False)


def _outline_to_structured(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    for i, title in enumerate(lines):
        title = str(title).strip()
        if not title:
            continue
        out.append({"id": f"p{i + 1}", "title": title, "bullets": []})
    return out


def _structured_to_outline_titles(outline: list) -> list[str]:
    titles: list[str] = []
    for item in outline:
        if isinstance(item, dict):
            t = item.get("title") or ""
            if t:
                titles.append(str(t).strip())
        elif isinstance(item, str) and item.strip():
            titles.append(item.strip())
    return titles


def _default_dynamic_questions(core_topic: str) -> list[dict]:
    return [
        {"question": f"这份「{core_topic[:40]}」PPT 的主要听众是谁？", "answer": ""},
        {"question": "希望突出哪些核心卖点或结论？", "answer": ""},
        {"question": "有没有必须包含的数据、案例或章节？", "answer": ""},
    ]


def _detect_intent(text: str, phase: str, draft: dict) -> str:
    if _GENERATE_RE.search(text) and _draft_ready(draft):
        return "ready"
    if _TEMPLATE_RE.search(text):
        return "show_templates"
    if _OUTLINE_RE.search(text):
        return "revise_outline"
    if _STYLE_RE.search(text):
        return "revise_style"
    if phase == "intake":
        return "clarify"
    if phase == "requirements":
        return "fill_requirements"
    return "clarify"


def _draft_ready(draft: dict) -> bool:
    pc = draft.get("phase_completed") or {}
    if not pc.get("requirements") or not pc.get("outline") or not pc.get("style"):
        return False
    if not (draft.get("core_topic") or "").strip():
        return False
    outline = draft.get("outline") or []
    if not outline:
        return False
    opts = draft.get("options") or {}
    if not opts.get("page_count"):
        return False
    return True


def _widgets_for_phase(phase: str, draft: dict, intent: str) -> list[dict]:
    widgets: list[dict] = []
    if intent == "show_templates":
        widgets.append({"type": "template_gallery"})
    if phase == "requirements" or intent == "fill_requirements":
        widgets.append({"type": "requirement_form"})
    if phase in ("outline", "style", "generating", "done") or intent in (
        "revise_outline",
        "ready",
    ):
        if draft.get("outline"):
            widgets.append({"type": "outline_board", "editable": phase == "outline"})
    if phase in ("style", "generating", "done") or intent in ("revise_style", "ready"):
        widgets.append({"type": "style_picker"})
    if intent == "ready" or (phase == "style" and _draft_ready(draft)):
        widgets.append({"type": "plan_summary", "can_generate": _draft_ready(draft)})
    return widgets


def _fallback_plan(
    *,
    phase: str,
    draft: dict,
    user_text: str,
    intent: str,
) -> dict:
    reply_map = {
        "intake": "好的，我先帮你整理需求。请填写下面的需求单，方便生成更合适的大纲。",
        "requirements": "请确认或补充需求单，完成后我会为你生成大纲。",
        "outline": "大纲已准备好，你可以直接编辑。确认后我们继续选择视觉风格。",
        "style": "请选择喜欢的视觉风格，确认后即可开始生成。",
        "generating": "正在生成中，请稍候…",
        "done": "生成已完成，可以下载 PPTX。",
    }
    reply = reply_map.get(phase, "好的，请继续。")
    if intent == "ready":
        reply = "方案已就绪，请确认下方摘要后点击「开始生成」。"
    elif intent == "show_templates":
        reply = "这里是可选模板，选中后会应用到美化流程（创建模式可跳过）。"
    next_phase = phase
    if phase == "intake":
        next_phase = "requirements"
    widgets = _widgets_for_phase(phase, draft, intent)
    return {
        "reply": reply,
        "draft_patch": {},
        "widgets": widgets,
        "intent": intent,
        "next_phase": next_phase,
    }


def _apply_autofill(draft: dict, autofill: dict) -> dict:
    patch: dict = {}
    if autofill.get("key_points"):
        patch["key_points"] = autofill["key_points"]
    so = autofill.get("suggested_options") or {}
    opts = deepcopy(draft.get("options") or {})
    for k in ("language", "scenario", "audience", "tone", "page_count"):
        if k in so:
            opts[k] = so[k]
    patch["options"] = opts
    if autofill.get("outline"):
        patch["outline"] = _outline_to_structured(autofill["outline"])
    style = autofill.get("style") or {}
    if style.get("visual_style"):
        opts["visual_style"] = style["visual_style"]
    if style.get("color_mode"):
        opts["color_mode"] = style["color_mode"]
    if style.get("brand_hex"):
        opts["brand_hex"] = style["brand_hex"]
    if style.get("industry"):
        opts["industry"] = style["industry"]
    if style.get("image_strategy"):
        opts["image_strategy"] = style["image_strategy"]
    req = deepcopy(draft.get("requirements") or {})
    if so.get("page_count"):
        req["page_count"] = so["page_count"]
    if so.get("scenario"):
        req["scenario"] = so["scenario"]
    patch["requirements"] = req
    return patch


def handle_intake(
    draft: dict,
    user_text: str,
    *,
    document_text: str | None = None,
) -> tuple[dict, dict, dict | None]:
    """首轮用户消息：设 core_topic，尝试 auto_fill，进入 requirements。"""
    topic = user_text.strip()[:200]
    draft_patch: dict = {
        "core_topic": topic,
        "requirements": {
            **(draft.get("requirements") or {}),
            "dynamic_answers": _default_dynamic_questions(topic),
        },
    }
    model_info: dict | None = None

    try:
        seed = document_text if document_text else topic
        autofill, model_info = llm.auto_fill(
            seed=seed,
            is_document=bool(document_text),
            scenario=draft_patch.get("requirements", {}).get("scenario", "general"),
        )
        af_patch = _apply_autofill(draft, autofill)
        _deep_merge(draft_patch, af_patch)
        if document_text and autofill.get("core_topic"):
            draft_patch["core_topic"] = autofill["core_topic"]
    except llm.LlmError as e:
        log.warning("auto_fill failed in intake: %s", e)

    plan = {
        "reply": (
            f"收到，主题是「{topic}」。\n\n"
            "我是你的 PPT 规划助手，接下来分几步确认：需求 → 大纲 → 风格 → 生成。"
            "请先填写下方需求单。"
        ),
        "draft_patch": draft_patch,
        "widgets": [{"type": "requirement_form"}],
        "intent": "fill_requirements",
        "next_phase": "requirements",
    }
    return plan, draft_patch, model_info


def handle_message(
    *,
    phase: str,
    draft: dict,
    user_text: str,
    history: list[dict[str, str]],
) -> tuple[dict, dict | None]:
    """处理用户消息，返回 (plan_dict, model_info)。"""
    intent = _detect_intent(user_text, phase, draft)

    if phase == "intake":
        plan, _, info = handle_intake(draft, user_text)
        return plan, info

    if phase in ("generating", "done"):
        return {
            "reply": "当前任务已在进行或已完成。如需调整，可说明要改大纲还是风格。",
            "draft_patch": {},
            "widgets": _widgets_for_phase(phase, draft, intent),
            "intent": intent,
            "next_phase": phase,
        }, None

    # Try LLM planner
    try:
        ctx = json.dumps(
            {"phase": phase, "draft": draft, "intent_hint": intent},
            ensure_ascii=False,
        )[:8000]
        msgs = history[-12:] + [{"role": "user", "content": f"{user_text}\n\n[context]{ctx}"}]
        parsed, info = llm.chat_turn_json(msgs, SYSTEM_PLANNER, max_tokens=2500)
        plan = _normalize_plan(parsed, phase, draft, intent)
        return plan, info
    except llm.LlmError as e:
        log.warning("planner LLM failed: %s", e)
        return _fallback_plan(phase=phase, draft=draft, user_text=user_text, intent=intent), None


def _normalize_plan(raw: dict, phase: str, draft: dict, intent: str) -> dict:
    reply = str(raw.get("reply") or "").strip() or "好的，请继续。"
    draft_patch = raw.get("draft_patch") if isinstance(raw.get("draft_patch"), dict) else {}
    next_phase = raw.get("next_phase") or phase
    if next_phase not in PHASES:
        next_phase = phase
    widgets = raw.get("widgets")
    if not isinstance(widgets, list) or not widgets:
        widgets = _widgets_for_phase(next_phase, draft, intent)
    return {
        "reply": reply,
        "draft_patch": draft_patch,
        "widgets": widgets,
        "intent": raw.get("intent") or intent,
        "next_phase": next_phase,
    }


def apply_requirements_submit(draft: dict, requirements: dict) -> dict:
    """用户提交需求单 → 生成大纲，进入 outline 阶段。"""
    req = deepcopy(draft.get("requirements") or {})
    req.update(requirements)
    page_count = int(req.get("page_count") or 10)
    core = (draft.get("core_topic") or "").strip()
    opts = deepcopy(draft.get("options") or {})
    opts["page_count"] = page_count
    opts["scenario"] = req.get("scenario") or opts.get("scenario") or "general"

    outline_struct: list[dict] = []
    try:
        titles, _ = llm.generate_outline(
            core_topic=core,
            page_count=page_count,
            scenario=opts.get("scenario", "general"),
            audience=opts.get("audience", "general"),
            language=opts.get("language", "zh"),
        )
        lines = titles.get("outline") if isinstance(titles, dict) else []
        if isinstance(lines, list):
            outline_struct = _outline_to_structured([str(x) for x in lines])
    except llm.LlmError as e:
        log.warning("generate_outline failed: %s", e)
        outline_struct = _outline_to_structured(
            [f"封面：{core}", "背景与痛点", "解决方案", "核心功能", "案例与数据", "总结与行动"]
        )[:page_count]

    return {
        "requirements": req,
        "options": opts,
        "outline": outline_struct,
        "phase_completed": {
            **(draft.get("phase_completed") or {}),
            "requirements": True,
        },
    }


def apply_outline_confirm(draft: dict) -> dict:
    return {
        "phase_completed": {
            **(draft.get("phase_completed") or {}),
            "outline": True,
        },
    }


def apply_style_confirm(draft: dict, options_patch: dict | None = None) -> dict:
    opts = deepcopy(draft.get("options") or {})
    if options_patch:
        opts.update(options_patch)
    return {
        "options": opts,
        "phase_completed": {
            **(draft.get("phase_completed") or {}),
            "style": True,
        },
    }


def _normalize_color_options(opts: dict) -> dict:
    """确保 color_mode 与 brand_hex / industry 联动合法，避免 JobOptions 校验失败。"""
    opts = deepcopy(opts)
    color_mode = opts.get("color_mode") or "auto"
    if color_mode == "brand":
        if not opts.get("brand_hex"):
            opts["color_mode"] = "auto"
            opts["brand_hex"] = None
    elif color_mode == "industry":
        if not opts.get("industry"):
            opts["industry"] = "technology"
    else:
        opts["brand_hex"] = None
        opts["industry"] = None
    return opts


def draft_to_job_form(draft: dict) -> dict:
    """把 draft 转成 job_options_from_form 参数。"""
    opts = _normalize_color_options(draft.get("options") or {})
    outline_titles = _structured_to_outline_titles(draft.get("outline") or [])
    form: dict[str, Any] = {
        "job_type": "generate",
        "language": opts.get("language", "zh"),
        "scenario": opts.get("scenario", "general"),
        "audience": opts.get("audience", "general"),
        "tone": opts.get("tone", "professional"),
        "page_count": int(opts.get("page_count") or 10),
        "canvas": opts.get("canvas", "ppt169"),
        "mode": opts.get("mode", "briefing"),
        "visual_style": opts.get("visual_style"),
        "color_mode": opts.get("color_mode", "auto"),
        "brand_hex": opts.get("brand_hex"),
        "industry": opts.get("industry"),
        "image_strategy": opts.get("image_strategy", "web"),
        "core_topic": draft.get("core_topic"),
        "outline": outline_titles or None,
        "key_points": draft.get("key_points") or None,
        "icon_strategy": opts.get("icon_strategy", "library"),
        "formula_policy": opts.get("formula_policy", "mixed"),
        "include_speaker_notes": opts.get("include_speaker_notes", True),
        "split_mode": opts.get("split_mode", False),
    }
    # Template selection in chat is informational for create mode; only beautify jobs use templates.
    return form


def new_message_id() -> str:
    return str(uuid.uuid4())
