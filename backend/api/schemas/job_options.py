"""Job creation options — validation and prompt formatting."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

# ── 现有枚举 ─────────────────────────────────────────────
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

# ── 新增枚举 ─────────────────────────────────────────────
Canvas = Literal["ppt169", "ppt43", "xhs", "story", "poster"]
Mode = Literal["briefing", "pyramid", "narrative", "instructional", "showcase"]
ColorMode = Literal["auto", "brand", "industry"]
ImageStrategy = Literal["ai", "web", "provided", "placeholder", "none"]
IconStrategy = Literal["emoji", "library", "ai", "custom"]
FormulaPolicy = Literal["mixed", "render-all", "text-only"]

# visual_style：ppt-master 全量 18 预设 + auto（auto = 由 AI 推荐）
VISUAL_STYLES = (
    "auto",
    "swiss-minimal",
    "soft-rounded",
    "glassmorphism",
    "dark-tech",
    "blueprint",
    "editorial",
    "photo-editorial",
    "data-journalism",
    "brutalist",
    "memphis",
    "zine",
    "vintage-poster",
    "paper-cut",
    "sketch-notes",
    "ink-notes",
    "chalkboard",
    "ink-wash",
    "pixel-art",
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_VISUAL_STYLE_CATALOG_PATH = _REPO_ROOT / "webui" / "src" / "lib" / "visualStyleCatalog.json"

# 配色行业预设：与 ppt-master INDUSTRY_COLORS 思路对齐
INDUSTRY_PRESETS = (
    "finance",       # 海军蓝 #003366
    "technology",    # 鲜亮蓝 #1565C0
    "healthcare",    # 青绿 #00796B
    "government",    # 中国红 #C41E3A
    "education",     # 学术深蓝
    "retail",        # 暖橙
    "creative",      # 多色
)

HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


class RevisionItem(BaseModel):
    """One user comment on a single slide in a revision request.

    The slide_index is 1-based and must match an actual slide in the
    original deck. ``comment`` is a free-text instruction, max 1000
    characters, that the agent will read verbatim.
    """

    slide_index: int = Field(ge=1, le=100)
    comment: str = Field(min_length=1, max_length=1000)


GlobalRevisionKind = Literal[
    "colors", "typography", "visual_style", "content", "custom"
]
ContentPreset = Literal["concise", "formal", "translate_en", "glossary"]

# spec_lock colors section keys exposed in the global color editor
SPEC_COLOR_KEYS = (
    "primary",
    "accent",
    "bg",
    "text",
    "text_secondary",
    "border",
)

_GLOBAL_VISUAL_STYLES = tuple(
    s for s in VISUAL_STYLES if s != "auto"
)


class GlobalRevision(BaseModel):
    """Deck-wide modification request (one kind per submission)."""

    kind: GlobalRevisionKind
    color_changes: dict[str, str] | None = None
    font_family: str | None = Field(default=None, max_length=500)
    visual_style: str | None = None
    content_preset: ContentPreset | None = None
    comment: str | None = Field(default=None, max_length=2000)

    def model_post_init(self, __context) -> None:  # type: ignore[override]
        if self.kind == "colors":
            if not self.color_changes:
                raise ValueError("color_changes is required for kind=colors")
            for key, val in self.color_changes.items():
                if key not in SPEC_COLOR_KEYS:
                    raise ValueError(
                        f"color_changes key must be one of {list(SPEC_COLOR_KEYS)}, got {key!r}"
                    )
                if not HEX_RE.match(val):
                    raise ValueError(f"color {key} must be #RRGGBB, got {val!r}")
        elif self.kind == "typography":
            if not self.font_family or not self.font_family.strip():
                raise ValueError("font_family is required for kind=typography")
        elif self.kind == "visual_style":
            if not self.visual_style or self.visual_style not in _GLOBAL_VISUAL_STYLES:
                raise ValueError(
                    f"visual_style must be one of {list(_GLOBAL_VISUAL_STYLES)}, "
                    f"got {self.visual_style!r}"
                )
        elif self.kind == "content":
            if not self.content_preset and not (self.comment and self.comment.strip()):
                raise ValueError(
                    "content_preset or comment is required for kind=content"
                )
        elif self.kind == "custom":
            if not self.comment or not self.comment.strip():
                raise ValueError("comment is required for kind=custom")


class RevisionRequest(BaseModel):
    """POST /revisions body — per-page or global (mutually exclusive)."""

    mode: Literal["per_page", "global"] = "per_page"
    items: list[RevisionItem] | None = Field(
        default=None,
        max_length=50,
        description="Per-slide comments when mode=per_page.",
    )
    global_revision: GlobalRevision | None = Field(
        default=None,
        description="Deck-wide modification when mode=global.",
    )

    @model_validator(mode="after")
    def _validate_mode_fields(self) -> "RevisionRequest":
        if self.mode == "per_page":
            if not self.items or len(self.items) < 1:
                raise ValueError("items must contain at least one entry for mode=per_page")
            if self.global_revision is not None:
                raise ValueError("global_revision must be omitted for mode=per_page")
        else:
            if self.global_revision is None:
                raise ValueError("global_revision is required for mode=global")
            if self.items:
                raise ValueError("items must be omitted for mode=global")
        return self


class JobOptions(BaseModel):
    # ── 现有（保持） ─────────────────────────────────────
    language: Language = "zh"
    scenario: Scenario = "general"
    audience: Audience = "general"
    tone: Tone = "professional"
    page_count: int = Field(default=5, ge=3, le=30)

    # ── 新增 Tier-1（全部 optional，老数据兼容） ──────────
    canvas: Canvas = "ppt169"
    mode: Mode = "briefing"
    visual_style: str | None = Field(default=None, description="VISUAL_STYLES 中之一；null/auto 表示由 AI 推荐")
    color_mode: ColorMode = "auto"
    brand_hex: str | None = Field(default=None, description="color_mode=brand 时使用；HEX 格式 #RRGGBB")
    industry: str | None = Field(default=None, description=f"color_mode=industry 时使用；IN {INDUSTRY_PRESETS}")
    image_strategy: ImageStrategy = "web"
    core_topic: str | None = Field(default=None, max_length=2000, description="一句话核心主题")
    outline: list[str] | None = Field(default=None, description="章节大纲，每行一个标题")
    key_points: list[str] | None = Field(default=None, description="重点强调，每行一个要点")

    # ── 高级 ─────────────────────────────────────────────
    icon_strategy: IconStrategy = "library"
    formula_policy: FormulaPolicy = "mixed"
    include_speaker_notes: bool = True
    split_mode: bool = False
    glossary: dict[str, str] | None = None

    # ── 修改（revisions） ────────────────────────────────
    # 当本 job 是对另一个已完成 job 的修改版时，由 queue_revision 写入；
    # 普通新建 job 此字段为 None。前端从 GET /jobs/{id}/revisions 取链。
    revision_items: list[RevisionItem] | None = Field(
        default=None,
        description="Per-slide modification comments driving this revision job",
    )
    revision_mode: Literal["per_page", "global"] | None = Field(
        default=None,
        description="How this revision job was created",
    )
    global_revision: GlobalRevision | None = Field(
        default=None,
        description="Deck-wide modification payload when revision_mode=global",
    )

    def model_post_init(self, __context) -> None:  # type: ignore[override]
        if self.visual_style is not None and self.visual_style not in VISUAL_STYLES:
            raise ValueError(
                f"visual_style must be one of {list(VISUAL_STYLES)}, got {self.visual_style!r}"
            )
        if self.brand_hex is not None and not HEX_RE.match(self.brand_hex):
            raise ValueError(f"brand_hex must be #RRGGBB, got {self.brand_hex!r}")
        if self.industry is not None and self.industry not in INDUSTRY_PRESETS:
            raise ValueError(
                f"industry must be one of {list(INDUSTRY_PRESETS)}, got {self.industry!r}"
            )
        if self.color_mode == "brand" and not self.brand_hex:
            raise ValueError("color_mode=brand requires brand_hex")
        if self.color_mode == "industry" and not self.industry:
            raise ValueError("color_mode=industry requires industry")


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

_CANVAS: dict[Canvas, str] = {
    "ppt169": "16:9 演示（默认）",
    "ppt43": "4:3 演示（兼容老投影）",
    "xhs": "小红书竖版 3:4",
    "story": "竖版 Story 9:16",
    "poster": "海报/单页",
}

_MODE: dict[Mode, tuple[str, str]] = {
    "briefing": ("简报", "客观陈述，按内容自然组织"),
    "pyramid": ("金字塔", "结论先行，论证后置（管理层推荐）"),
    "narrative": ("叙事", "开场→冲突→解决的故事线"),
    "instructional": ("教学", "循序渐进、步骤清晰"),
    "showcase": ("展示", "视觉主导、案例驱动"),
}

@lru_cache(maxsize=1)
def _visual_style_catalog_entries() -> dict[str, dict]:
    """Load per-style metadata from webui catalog (single source of truth)."""
    if not _VISUAL_STYLE_CATALOG_PATH.is_file():
        return {}
    data = json.loads(_VISUAL_STYLE_CATALOG_PATH.read_text(encoding="utf-8"))
    return {s["id"]: s for s in data.get("styles", []) if s.get("id")}


def _visual_style_desc(style_id: str) -> str:
    entry = _visual_style_catalog_entries().get(style_id)
    if entry:
        return f"{entry.get('title', style_id)}：{entry.get('tagline', '')}"
    return style_id

_INDUSTRY_COLOR: dict[str, str] = {
    "finance": "海军蓝 #003366 — 稳重可信",
    "technology": "鲜亮蓝 #1565C0 — 创新活力",
    "healthcare": "青绿 #00796B — 专业安心",
    "government": "中国红 #C41E3A — 庄重权威",
    "education": "学术深蓝 — 严谨学术",
    "retail": "暖橙 — 亲和消费",
    "creative": "多色拼接 — 创意活泼",
}

_IMAGE_STRATEGY: dict[ImageStrategy, str] = {
    "ai": "AI 生图（本环境无 key 则可能失败）",
    "web": "网络搜图（默认，速度快）",
    "provided": "仅使用用户上传的图片",
    "placeholder": "占位符/纯色块",
    "none": "不使用图片",
}

_ICON_STRATEGY: dict[IconStrategy, str] = {
    "emoji": "Emoji（casual/social）",
    "library": "内置图标库（默认，专业）",
    "ai": "AI 生成图标",
    "custom": "用户自定义",
}

_FORMULA_POLICY: dict[FormulaPolicy, str] = {
    "mixed": "复杂公式渲染为图、简单表达式留文本（默认）",
    "render-all": "全部公式渲染为图",
    "text-only": "全部留文本/Unicode",
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
    canvas: str = "ppt169",
    mode: str = "briefing",
    visual_style: str | None = None,
    color_mode: str = "auto",
    brand_hex: str | None = None,
    industry: str | None = None,
    image_strategy: str = "web",
    core_topic: str | None = None,
    outline: list[str] | None = None,
    key_points: list[str] | None = None,
    icon_strategy: str = "library",
    formula_policy: str = "mixed",
    include_speaker_notes: bool = True,
    split_mode: bool = False,
) -> JobOptions:
    # visual_style="auto" 等价于 None（让 agent 自己挑）
    vs = visual_style if visual_style and visual_style != "auto" else None
    return JobOptions(
        language=language,
        scenario=scenario,
        audience=audience,
        tone=tone,
        page_count=page_count,
        canvas=canvas,
        mode=mode,
        visual_style=vs,
        color_mode=color_mode,
        brand_hex=brand_hex,
        industry=industry,
        image_strategy=image_strategy,
        core_topic=core_topic,
        outline=outline,
        key_points=key_points,
        icon_strategy=icon_strategy,
        formula_policy=formula_policy,
        include_speaker_notes=include_speaker_notes,
        split_mode=split_mode,
    )


def format_options_for_prompt(opts: JobOptions) -> str:
    """把 JobOptions 渲染成 agent prompt 中的一段结构化中文要求。

    agent 拿到后能直接对照执行，不再瞎猜默认值。
    """
    lang_label, lang_hint = _LANGUAGE[opts.language]
    scen_label, scen_hint = _SCENARIO[opts.scenario]
    aud_label, aud_hint = _AUDIENCE[opts.audience]
    tone_label, tone_hint = _TONE[opts.tone]
    mode_label, mode_hint = _MODE[opts.mode]

    lines: list[str] = ["PPT 生成要求（请严格遵循）：", ""]

    # ── 画布与结构 ─────────────────────────────────────
    lines.append("【画布与结构】")
    lines.append(f"- 画布：{_CANVAS[opts.canvas]}")
    lines.append(f"- 目标页数：约 {opts.page_count} 页（可在 ±1 页内微调以适配内容，但不要明显超出）")
    lines.append(f"- 叙事模式：{mode_label}（{mode_hint}）")
    locked_style = opts.visual_style if opts.visual_style and opts.visual_style != "auto" else None
    if locked_style:
        style_desc = _visual_style_desc(locked_style)
        lines.append(f"- 视觉风格：{locked_style}（{style_desc}）")
    else:
        lines.append("- 视觉风格：auto（请根据内容/受众/场合自己挑选最合适的视觉风格预设，不要默认扁平卡片网格）")
    lines.append("")

    # ── 视觉风格锁定（用户已选） ─────────────────────────
    if locked_style:
        meta = _visual_style_catalog_entries().get(locked_style, {})
        lines.append("【视觉风格锁定（用户已选，不得覆盖）】")
        lines.append(
            f"- spec_lock.md 的 visual_style 必须写为：{locked_style}；"
            "禁止改为 auto、其它预设或 image-rendering 名（flat、digital-dashboard 等）"
        )
        lines.append(
            f"- 必须先 read_file：skills/ppt-master/references/visual-styles/{locked_style}.md"
            " 并严格遵循其形状/留白/禁止项"
        )
        paired = meta.get("pairedRendering")
        if paired:
            lines.append(
                f"- 有图时 image_rendering 优先配对：{paired}（写入 design_spec / spec_lock）"
            )
        rules = meta.get("rules") or []
        if rules:
            lines.append("- 执行检查清单：")
            for rule in rules:
                lines.append(f"  · {rule}")
        lines.append(
            "- 封面、内容页、结尾页共用同一套 spec_lock.colors；"
            "封面/结尾可换布局节奏（anchor/breathing），但不得单独换主色或违背风格禁止项"
        )
        lines.append("")

    # ── 配色 ───────────────────────────────────────────
    lines.append("【配色】")
    if opts.color_mode == "brand" and opts.brand_hex:
        lines.append(f"- 模式：品牌色（主色 {opts.brand_hex}）")
        lines.append("- 严格使用品牌色作为 primary，不要替换为行业默认；其余配色围绕主色协调")
    elif opts.color_mode == "industry" and opts.industry:
        ind_desc = _INDUSTRY_COLOR.get(opts.industry, opts.industry)
        lines.append(f"- 模式：行业预设（{opts.industry} — {ind_desc}）")
    else:
        lines.append("- 模式：auto（请根据行业/受众/场合自动选色，遵循 60-30-10 规则）")
        if locked_style:
            color_hint = _visual_style_catalog_entries().get(locked_style, {}).get("colorHint")
            if color_hint:
                lines.append(f"- 已与锁定风格搭配的配色倾向（非强制 HEX）：{color_hint}")
    lines.append("")

    # ── 图片策略 ───────────────────────────────────────
    img_desc = _IMAGE_STRATEGY[opts.image_strategy]
    lines.append("【图片策略】")
    lines.append(f"- 来源：{opts.image_strategy}（{img_desc}）")
    if opts.image_strategy != "ai":
        lines.append("- 不要尝试 AI 生图（除非用户明确要求）")
    lines.append("")

    # ── 内容定位 ───────────────────────────────────────
    lines.append("【内容定位】")
    lines.append(f"- 语言：{lang_label}（{lang_hint}）")
    lines.append(f"- 场景：{scen_label}（{scen_hint}）")
    lines.append(f"- 目标受众：{aud_label}（{aud_hint}）")
    lines.append(f"- 语调：{tone_label}（{tone_hint}）")
    if opts.core_topic:
        lines.append(f"- 核心主题：{opts.core_topic}")
    lines.append("")

    # ── 大纲（用户提供则严格遵循） ─────────────────────
    if opts.outline:
        lines.append("【大纲（按顺序，不要改动章节标题或重排顺序）】")
        for i, h in enumerate(opts.outline, 1):
            h = h.strip()
            if h:
                lines.append(f"  {i}. {h}")
        lines.append("")

    # ── 重点强调 ───────────────────────────────────────
    if opts.key_points:
        lines.append("【重点强调（这些点必须在 PPT 中突出呈现）】")
        for p in opts.key_points:
            p = p.strip()
            if p:
                lines.append(f"  - {p}")
        lines.append("")

    # ── 术语表（本期 UI 未接，schema 预留透传） ────────
    if opts.glossary:
        lines.append("【术语表（PPT 中首次出现时使用以下定义）】")
        for k, v in opts.glossary.items():
            lines.append(f"  - {k}：{v}")
        lines.append("")

    # ── 高级开关 ───────────────────────────────────────
    lines.append("【输出约束】")
    lines.append(f"- 图标策略：{opts.icon_strategy}（{_ICON_STRATEGY[opts.icon_strategy]}）")
    lines.append(f"- 公式渲染策略：{opts.formula_policy}（{_FORMULA_POLICY[opts.formula_policy]}）")
    lines.append(f"- 生成演讲者备注：{'是' if opts.include_speaker_notes else '否'}")
    if opts.split_mode:
        lines.append("- 长 deck 提示：在 Phase A 完成后建议用户切到 split mode（继续生成 projects/<name>）")
    return "\n".join(lines)
