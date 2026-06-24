"""LLM 客户端：调用应用设置中配置的模型（当前仅支持 anthropic 协议）。

不引入第三方 SDK，用 stdlib urllib 调 Anthropic Messages API。
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from backend.config import get_config_response, get_secrets_raw

log = logging.getLogger("backend.app.llm")

# 调用超时：AI 优化都是短 prompt，60s 足够
_HTTP_TIMEOUT_S = 60


class LlmError(Exception):
    """所有 LLM 相关失败的统一异常。

    code: 错误分类，供 API 层映射成对应 HTTP 状态码：
      - no_default_model / default_disabled / no_api_key  → 503
      - unsupported_protocol                              → 501
      - auth_error                                        → 502
      - upstream_4xx / upstream_5xx / network_error       → 502
      - parse_error                                       → 502
    """

    def __init__(
        self,
        message: str,
        code: str = "llm_error",
        upstream_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.upstream_status = upstream_status


def get_default_model() -> tuple[dict, str]:
    """取 (model_entry, api_key)。无默认模型或未配 key 抛 LlmError。"""
    cfg = get_config_response()
    models = ((cfg.get("app") or {}).get("models") or [])
    if not isinstance(models, list):
        raise LlmError("app.models 不是列表", code="no_default_model")
    default = next((m for m in models if isinstance(m, dict) and m.get("is_default")), None)
    if not default:
        raise LlmError("没有配置默认模型，请到管理后台 → 应用设置 启用并设默认", code="no_default_model")
    if not default.get("enabled", True):
        raise LlmError("默认模型未启用", code="default_disabled")
    api_key = get_secrets_raw().get(f"model:{default['id']}:api_key")
    if not api_key:
        raise LlmError(f"默认模型 {default.get('name') or default['id']} 未配置 API Key", code="no_api_key")
    return default, api_key


def _build_messages_url(base_url: str) -> str:
    """拼 Messages API endpoint URL。

    兼容：用户填的 base_url 可能是裸 host、可能含 /v1、可能含 /v1/messages。
    """
    base = (base_url or "").strip().rstrip("/")
    for suffix in ("/v1/messages", "/messages", "/v1"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return base + "/v1/messages"


def _extract_json(text: str) -> dict:
    """从模型输出里抠 JSON 对象。模型可能返回 ```json ... ``` 包裹。"""
    text = text.strip()
    # 尝试直接 parse
    try:
        v = json.loads(text)
        if isinstance(v, dict):
            return v
    except json.JSONDecodeError:
        pass
    # 去掉 markdown 围栏再试
    if text.startswith("```"):
        # 去掉首尾 ``` / ```json
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        v = json.loads(text)
        if isinstance(v, dict):
            return v
    except json.JSONDecodeError:
        pass
    # 兜底：抓第一个 { ... } 块
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            v = json.loads(text[start : end + 1])
            if isinstance(v, dict):
                return v
        except json.JSONDecodeError:
            pass
    raise LlmError(f"模型输出不是有效 JSON: {text[:200]!r}", code="parse_error")


def chat_json(
    system: str,
    user: str,
    *,
    max_tokens: int = 2048,
    temperature: float = 0.4,
) -> tuple[dict, dict]:
    """调默认模型，返回 (parsed_json, model_info)。

    model_info: {"id", "name", "provider", "model"}，供前端显示「当前模型：xxx」。
    """
    model, api_key = get_default_model()
    protocol = (model.get("protocol") or "").lower()
    if protocol != "anthropic":
        raise LlmError(
            f"暂不支持的协议: {protocol}（当前仅支持 anthropic 兼容）",
            code="unsupported_protocol",
        )

    url = _build_messages_url(model["base_url"])
    payload = {
        "model": model["model"],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:
            data = resp.read().decode("utf-8")
            upstream_status = resp.status
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        log.warning("LLM upstream HTTP %s: %s", e.code, err_body)
        if e.code in (401, 403):
            raise LlmError(f"鉴权失败（{e.code}）", code="auth_error", upstream_status=e.code) from e
        if 400 <= e.code < 500:
            raise LlmError(
                f"上游 4xx（{e.code}）：{err_body}",
                code="upstream_4xx",
                upstream_status=e.code,
            ) from e
        raise LlmError(
            f"上游 5xx（{e.code}）：{err_body}",
            code="upstream_5xx",
            upstream_status=e.code,
        ) from e
    except urllib.error.URLError as e:
        raise LlmError(f"网络错误：{e.reason}", code="network_error") from e
    except TimeoutError as e:
        raise LlmError(f"请求超时（>{_HTTP_TIMEOUT_S}s）", code="network_error") from e

    try:
        outer = json.loads(data)
    except json.JSONDecodeError as e:
        raise LlmError(f"上游返回非 JSON：{data[:200]!r}", code="parse_error") from e

    # 抠出 text 字段
    content = outer.get("content") or []
    text_parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
    text = "".join(text_parts).strip()
    if not text:
        raise LlmError(f"上游返回无 text 内容：{data[:200]!r}", code="parse_error")

    parsed = _extract_json(text)
    info = {
        "id": model["id"],
        "name": model.get("name") or model["id"],
        "provider": model.get("provider") or "",
        "model": model.get("model") or "",
    }
    return parsed, info


# ── 三个 AI 端点用的 system prompts ─────────────────────────

SYSTEM_OPTIMIZE_PROMPT = """你是 PPT 创作助手。根据用户提供的主题，输出一段扩展后的、适合交给 PPT 生成 agent 的中文描述。

要求：
- 明确核心信息（这个 deck 想传达什么）
- 列出 3-5 个关键观点（要传达给受众的洞察）
- 给出建议的叙事结构（一两句话：先讲什么、后讲什么、如何收尾）
- 顺便根据主题推荐 5 个默认设置（用户可手动改）：
  * language: zh / en / bilingual（首选 zh，除非主题明显是英文内容）
  * scenario: general / proposal / product / training / popular_science / speech / project_report
    （按主题选最贴近的；不确定就用 general）
  * audience: general / executive / team / client / expert / student
  * tone: professional / friendly / technical / academic / concise
  * page_count: 3-30 的整数，按内容厚度合理推荐（短介绍 5-7、综合汇报 8-12、培训/课程 12-20、长篇综述 20+）

- 仅输出 JSON，键名固定：
  {
    "optimized_prompt": "<扩展后的描述>",
    "key_points": ["...", "...", "..."],
    "suggested_options": {
      "language": "...",
      "scenario": "...",
      "audience": "...",
      "tone": "...",
      "page_count": <int>
    }
  }
不要输出 markdown 围栏、不要解释、不要寒暄。"""

SYSTEM_GENERATE_OUTLINE = """你是 PPT 大纲设计师。根据用户提供的主题与目标页数，生成一个适合该场景的结构化大纲。

要求：
- 总章节数 = page_count（封面 + 主体章节 + 结尾致谢/CTA）
- 每条一行，开头用「第N章」中文数字或破折号，便于逐行展示
- 章节标题要具体、信息密度高，不能是"引言/概述/总结"这种万能词
- 章节之间要有递进关系
- 语言根据传入的 lang
- 仅输出 JSON：{"outline": ["第1章 ...", "第2章 ...", ...]}
不要 markdown 围栏。"""

SYSTEM_SUGGEST_STYLE = """你是 PPT 视觉设计顾问。根据提供的主题、场景、受众、语调，从给定目录中推荐 2-3 组 (visual_style, color_mode, image_strategy) 组合。

visual_style 取自：auto, swiss-minimal, glassmorphism, dark-tech, brutalist, editorial, blueprint, photo-editorial, soft-rounded, data-journalism, memphis

color_mode 取自：auto, brand, industry（brand 时给一个推荐 brand_hex；industry 时给一个 industry 值）

image_strategy 取自：ai, web, provided, placeholder, none

要求：
- 每组 suggestion 都要有 rationale（一句话解释为什么适合这个内容）
- 不推荐 ai 生图（除非用户明确说需要 AI 创作插图）
- 默认首选 web / provided
- 仅输出 JSON：
  {"suggestions": [
    {"visual_style": "...", "color_mode": "...", "image_strategy": "...", "brand_hex": "#RRGGBB (color_mode=brand 时填)", "industry": "... (color_mode=industry 时填)", "rationale": "..."},
    ...
  ]}
不要 markdown 围栏。"""


_VALID_LANGUAGES = {"zh", "en", "bilingual"}
_VALID_SCENARIOS = {
    "general", "proposal", "product", "training",
    "popular_science", "speech", "project_report",
}
_VALID_AUDIENCES = {
    "general", "executive", "team", "client", "expert", "student",
}
_VALID_TONES = {"professional", "friendly", "technical", "academic", "concise"}


def _pick_enum(raw: Any, allowed: set[str], default: str) -> str:
    """如果 raw ∈ allowed 返回它，否则返回 default。"""
    if isinstance(raw, str) and raw in allowed:
        return raw
    return default


def _pick_int(raw: Any, lo: int, hi: int, default: int) -> int:
    """如果 raw 是 lo..hi 范围内的整数，返回它，否则返回 default。"""
    if isinstance(raw, bool):  # bool 是 int 子类，先排除
        return default
    if isinstance(raw, int) and lo <= raw <= hi:
        return raw
    return default


def optimize_prompt(
    core_topic: str,
    scenario: str,
    audience: str,
    tone: str,
    language: str = "zh",
) -> tuple[dict, dict]:
    """调用默认模型优化用户输入的简短主题，输出结构化扩展描述。

    返回 {"optimized_prompt", "key_points", "suggested_options"}，其中
    suggested_options 是经枚举白名单校验的干净 dict（无效字段走调用方传入的原值兜底）。
    """
    user = f"主题：{core_topic}"
    parsed, info = chat_json(SYSTEM_OPTIMIZE_PROMPT, user, max_tokens=1500)

    optimized = parsed.get("optimized_prompt") or core_topic
    if not isinstance(optimized, str) or not optimized.strip():
        optimized = core_topic

    key_points = parsed.get("key_points") or []
    if not isinstance(key_points, list):
        key_points = []

    suggested_raw = parsed.get("suggested_options") or {}
    if not isinstance(suggested_raw, dict):
        suggested_raw = {}

    # 校验 enum + 范围；不合法用调用方原值兜底
    suggested_options = {
        "language": _pick_enum(suggested_raw.get("language"), _VALID_LANGUAGES, language),
        "scenario": _pick_enum(suggested_raw.get("scenario"), _VALID_SCENARIOS, scenario),
        "audience": _pick_enum(suggested_raw.get("audience"), _VALID_AUDIENCES, audience),
        "tone": _pick_enum(suggested_raw.get("tone"), _VALID_TONES, tone),
        "page_count": _pick_int(suggested_raw.get("page_count"), 3, 30, 5),
    }

    return {
        "optimized_prompt": str(optimized).strip(),
        "key_points": [str(x).strip() for x in key_points if str(x).strip()][:8],
        "suggested_options": suggested_options,
    }, info


def generate_outline(
    core_topic: str,
    page_count: int,
    scenario: str,
    audience: str,
    language: str = "zh",
) -> tuple[dict, dict]:
    user = (
        f"主题：{core_topic}\n"
        f"目标页数：{page_count}\n"
        f"场景：{scenario}\n"
        f"受众：{audience}\n"
        f"语言：{language}"
    )
    parsed, info = chat_json(SYSTEM_GENERATE_OUTLINE, user, max_tokens=1500)
    outline = parsed.get("outline") or []
    if not isinstance(outline, list):
        outline = []
    return {
        "outline": [str(x).strip() for x in outline if str(x).strip()][: page_count + 2],
    }, info


def suggest_style(
    core_topic: str,
    scenario: str,
    audience: str,
    tone: str,
) -> tuple[dict, dict]:
    user = (
        f"主题：{core_topic}\n"
        f"场景：{scenario}\n"
        f"受众：{audience}\n"
        f"语调：{tone}"
    )
    parsed, info = chat_json(SYSTEM_SUGGEST_STYLE, user, max_tokens=1500)
    suggestions = parsed.get("suggestions") or []
    if not isinstance(suggestions, list):
        suggestions = []
    # 规范化每条
    norm: list[dict] = []
    for s in suggestions[:3]:
        if not isinstance(s, dict):
            continue
        norm.append({
            "visual_style": s.get("visual_style") or "auto",
            "color_mode": s.get("color_mode") or "auto",
            "image_strategy": s.get("image_strategy") or "web",
            "brand_hex": s.get("brand_hex"),
            "industry": s.get("industry"),
            "rationale": str(s.get("rationale") or "").strip(),
        })
    return {"suggestions": norm}, info


# ── 智能填充（合并接口）─────────────────────────────────

SYSTEM_AUTOFILL_PROMPT = """你是 PPT 创作总策划。根据用户提供的「主题」或「文档内容」，一次性产出整套创作方案，供前端自动填充各字段。

你必须在一次输出里给出以下全部内容：

1. core_topic：一句话核心主题（仅当输入是文档时需要从文档提炼；输入是主题时原样回传、可微调措辞）。≤200 字，要能独立概括这个 deck 讲什么。

2. key_points：3-6 条要重点传达的洞察/数据/卖点，每条一行。

3. suggested_options（用户可改的 5 个默认设置）：
   * language: zh / en / bilingual（首选 zh，除非内容明显是英文）
   * scenario: general / proposal / product / training / popular_science / speech / project_report
   * audience: general / executive / team / client / expert / student
   * tone: professional / friendly / technical / academic / concise
   * page_count: 3-30 整数（短介绍 5-7、综合汇报 8-12、培训 12-20、长篇综述 20+）

4. outline：章节大纲，条数尽量接近 page_count（含封面与结尾）。每条一行，开头用「第N章」或破折号，标题要具体、有递进，禁用「引言/概述/总结」这类万能词。

5. style（视觉设计推荐，只给一组首选）：
   * visual_style: auto / swiss-minimal / glassmorphism / dark-tech / brutalist / editorial / blueprint / photo-editorial / soft-rounded / data-journalism / memphis
   * color_mode: auto / brand / industry（brand 时给 brand_hex；industry 时给 industry）
   * brand_hex: #RRGGBB（仅 color_mode=brand 时填，否则 null）
   * industry: finance / technology / healthcare / government / education / retail / creative（仅 color_mode=industry 时填，否则 null）
   * image_strategy: ai / web / provided / placeholder / none（默认首选 web；除非用户明确要 AI 创作插图，否则不要选 ai）

仅输出 JSON，结构固定如下，不要 markdown 围栏、不要解释、不要寒暄：
{
  "core_topic": "...",
  "key_points": ["...", "..."],
  "suggested_options": {"language": "...", "scenario": "...", "audience": "...", "tone": "...", "page_count": <int>},
  "outline": ["第1章 ...", "第2章 ..."],
  "style": {"visual_style": "...", "color_mode": "...", "brand_hex": "...", "industry": "...", "image_strategy": "..."}
}"""

_VALID_VISUAL_STYLES = {
    "auto", "swiss-minimal", "glassmorphism", "dark-tech", "brutalist",
    "editorial", "blueprint", "photo-editorial", "soft-rounded",
    "data-journalism", "memphis",
}
_VALID_COLOR_MODES = {"auto", "brand", "industry"}
_VALID_IMAGE_STRATEGIES = {"ai", "web", "provided", "placeholder", "none"}
_VALID_INDUSTRIES = {
    "finance", "technology", "healthcare", "government",
    "education", "retail", "creative",
}


def _norm_style(raw: Any) -> dict:
    """规范 style 字段：枚举校验 + brand_hex/industry 与 color_mode 联动。"""
    if not isinstance(raw, dict):
        raw = {}
    color_mode = _pick_enum(raw.get("color_mode"), _VALID_COLOR_MODES, "auto")
    brand_hex = raw.get("brand_hex") if color_mode == "brand" else None
    if not isinstance(brand_hex, str):
        brand_hex = None
    industry = _pick_enum(
        raw.get("industry"), _VALID_INDUSTRIES, "technology"
    ) if color_mode == "industry" else None
    return {
        "visual_style": _pick_enum(raw.get("visual_style"), _VALID_VISUAL_STYLES, "auto"),
        "color_mode": color_mode,
        "brand_hex": brand_hex,
        "industry": industry,
        "image_strategy": _pick_enum(
            raw.get("image_strategy"), _VALID_IMAGE_STRATEGIES, "web"
        ),
    }


def auto_fill(
    *,
    seed: str,
    is_document: bool,
    scenario: str = "general",
    audience: str = "general",
    tone: str = "professional",
    language: str = "zh",
) -> tuple[dict, dict]:
    """智能填充：单次 LLM 调用产出整套方案。

    seed: 主题模式下是用户输入的主题文本；文档模式下是提取出的文档 markdown。
    is_document: True=文档模式（需从 seed 提炼 core_topic），False=主题模式。
    返回 {core_topic?, key_points, suggested_options, outline, style}，其中
    core_topic 仅文档模式返回（主题模式不动用户输入）。
    """
    if is_document:
        user = (
            f"以下是用户上传的文档内容（已转为 markdown，可能截断）：\n\n"
            f"{seed}\n\n"
            f"请基于文档内容提炼核心主题并产出整套方案。"
        )
    else:
        user = (
            f"主题：{seed}\n"
            f"场景：{scenario}\n受众：{audience}\n语调：{tone}\n语言：{language}\n\n"
            f"请基于该主题产出整套方案。core_topic 可在原主题基础上微调措辞。"
        )

    parsed, info = chat_json(SYSTEM_AUTOFILL_PROMPT, user, max_tokens=3000)

    key_points = parsed.get("key_points") or []
    if not isinstance(key_points, list):
        key_points = []
    key_points = [str(x).strip() for x in key_points if str(x).strip()][:8]

    suggested_raw = parsed.get("suggested_options") or {}
    if not isinstance(suggested_raw, dict):
        suggested_raw = {}
    suggested_options = {
        "language": _pick_enum(suggested_raw.get("language"), _VALID_LANGUAGES, language),
        "scenario": _pick_enum(suggested_raw.get("scenario"), _VALID_SCENARIOS, scenario),
        "audience": _pick_enum(suggested_raw.get("audience"), _VALID_AUDIENCES, audience),
        "tone": _pick_enum(suggested_raw.get("tone"), _VALID_TONES, tone),
        "page_count": _pick_int(suggested_raw.get("page_count"), 3, 30, 5),
    }

    outline = parsed.get("outline") or []
    if not isinstance(outline, list):
        outline = []
    outline = [str(x).strip() for x in outline if str(x).strip()]
    # 上限：page_count + 封面/结尾余量
    outline = outline[: suggested_options["page_count"] + 2]

    style = _norm_style(parsed.get("style"))

    result: dict = {
        "key_points": key_points,
        "suggested_options": suggested_options,
        "outline": outline,
        "style": style,
    }

    # 文档模式：返回提炼出的 core_topic；主题模式：不返回，前端保持用户输入
    if is_document:
        core_topic = parsed.get("core_topic")
        if isinstance(core_topic, str) and core_topic.strip():
            result["core_topic"] = core_topic.strip()[:200]

    return result, info
