"""Pipeline stage classification and project path helpers."""
from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING

from backend.paths import translate_paths_for_container

if TYPE_CHECKING:
    from backend.api.schemas.job_options import JobOptions

STAGE_RULES: list[tuple[callable, str]] = [
    (lambda c, f, w: "source_to_md" in c, "1 解析素材"),
    (lambda c, f, w: "project_manager.py init" in c or "project_manager.py import" in c, "2 建项目"),
    (lambda c, f, w: "beautify_inventory.py" in c or "beautify_identity.py" in c, "4 分析源 PPT"),
    # ↓ 仅 write=True 时才让 spec 文件命中阶段 3（Read tool 重读不算）
    (lambda c, f, w: w is True and ("design_spec.md" in f or "spec_lock.md" in f),
     "3 策略规划(八点确认)"),
    (lambda c, f, w: "image_gen.py" in c or "image_search.py" in c, "5 生图"),
    (lambda c, f, w: "svg_quality_checker.py" in c, "7 质检"),
    (lambda c, f, w: "finalize_svg.py" in c or "total_md_split.py" in c, "8 后处理"),
    (lambda c, f, w: "svg_to_pptx.py" in c, "8 导出 PPTX"),
]

SVG_PAGE_RE = re.compile(r"svg_output/.*\.svg$", re.IGNORECASE)
SPEC_RE = re.compile(r"(design_spec|spec_lock)\.md$", re.IGNORECASE)


def classify_stage(command: str, file_path: str, *, write: bool | None = None) -> str | None:
    """根据 Bash 命令 / 文件路径判断当前处于哪个阶段。

    write=None: 向后兼容（不区分 Read/Write，行为同 Phase 0 旧实现）
    write=True: 文件被 Write 工具写
    write=False: 文件被 Read 工具读
    """
    for match, stage in STAGE_RULES:
        try:
            if match(command, file_path, write):
                return stage
        except Exception:
            continue
    if file_path and SVG_PAGE_RE.search(file_path.replace("\\", "/")):
        return "6 逐页生成 SVG"
    return None


def resolve_project_dir(project_name: str, root: Path) -> Path | None:
    """project_manager.py init 会把目录命名为 <name>_<format>_<date>，
    所以不能直接用 <name>，要按前缀在 project_root 下找真实目录（取最新）。

    Phase 2: root 是 per-user project_root（`data/users/<uid>/projects/<job_id>/`）。
    Agent 实际会把 `<name>_<format>_<date>/` 直接建在 root 下；部分环境也可能
    建在 `<root>/projects/` 下，两处都查。
    """
    hits: list[Path] = []
    for base in (root / "projects", root):
        if not base.is_dir():
            continue
        hits.extend(
            p for p in base.iterdir()
            if p.is_dir() and p.name.startswith(project_name)
        )
    if not hits:
        return None
    return max(hits, key=lambda p: p.stat().st_mtime)


def find_pptx(
    root: Path,
    *,
    project_name: str | None = None,
    beautify: bool = False,
) -> Path | None:
    """Find the best downloadable PPTX under a per-user project_root.

    root is ``data/users/<uid>/projects/<job_id>/``. Exported decks normally
    live in ``<project>/exports/*.pptx``.

    ``sources/`` and ``templates/`` are never returned — beautify jobs always
    import the source deck into ``sources/``, and those copies must not be
    treated as successful output.

    When ``beautify=True``, only ``exports/*.pptx`` is considered.
    """
    if not root or not root.exists():
        return None

    export_hits = _export_pptx_hits(root, project_name=project_name)
    if beautify:
        return export_hits[0] if export_hits else None
    if export_hits:
        return export_hits[0]

    other_hits = _other_pptx_hits(root)
    return other_hits[0] if other_hits else None


_EXCLUDED_PPTX_DIRS = frozenset({"sources", "templates"})


def _export_pptx_hits(root: Path, *, project_name: str | None = None) -> list[Path]:
    """Newest-first PPTX files under any ``exports/`` directory."""
    hits: list[Path] = []
    if project_name:
        project_dir = resolve_project_dir(project_name, root=root)
        if project_dir:
            exp = project_dir / "exports"
            if exp.is_dir():
                hits.extend(exp.glob("*.pptx"))
    for p in root.rglob("*.pptx"):
        if "exports" not in p.parts:
            continue
        if p not in hits:
            hits.append(p)
    return sorted(hits, key=lambda p: p.stat().st_mtime, reverse=True)


def _other_pptx_hits(root: Path) -> list[Path]:
    """Newest-first PPTX outside excluded dirs and outside exports."""
    hits: list[Path] = []
    for p in root.rglob("*.pptx"):
        rel_parts = p.relative_to(root).parts
        if set(rel_parts) & _EXCLUDED_PPTX_DIRS:
            continue
        if "exports" in rel_parts:
            continue
        hits.append(p)
    return sorted(hits, key=lambda p: p.stat().st_mtime, reverse=True)


def beautify_expected_slide_count(project_dir: Path | None) -> int | None:
    """Read planned slide count from beautify analysis artifacts."""
    if not project_dir or not project_dir.is_dir():
        return None
    inv_path = project_dir / "analysis" / "beautify_inventory.json"
    if inv_path.is_file():
        try:
            import json

            inv = json.loads(inv_path.read_text(encoding="utf-8"))
            count = inv.get("slide_count")
            if isinstance(count, int) and count > 0:
                return count
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    return None


def beautify_svg_final_count(project_dir: Path | None) -> int:
    if not project_dir or not project_dir.is_dir():
        return 0
    svg_final = project_dir / "svg_final"
    if not svg_final.is_dir():
        return 0
    return len(list(svg_final.glob("*.svg")))


def beautify_output_ready(project_dir: Path | None) -> tuple[bool, str]:
    """Return whether a beautify job produced a complete export."""
    if not project_dir or not project_dir.is_dir():
        return False, "project directory missing"

    exports_dir = project_dir / "exports"
    export_hits = sorted(exports_dir.glob("*.pptx"), key=lambda p: p.stat().st_mtime, reverse=True) if exports_dir.is_dir() else []
    if not export_hits:
        return False, "no exported pptx in exports/"

    expected = beautify_expected_slide_count(project_dir)
    actual = beautify_svg_final_count(project_dir)
    if expected is not None and actual < expected:
        return False, f"only completed {actual}/{expected} slides; export incomplete"

    return True, ""


def _project_snapshot(root: Path) -> tuple:
    """给 project_root 拍「文件指纹」——检测 agent 是否有实质进展。

    返回 (file_count, total_size, max_mtime, sorted_names)：
      - file_count：文件总数（写新文件 / 删旧文件都会变）
      - total_size：所有文件 size 加起来（编辑 SVG 会变）
      - max_mtime：最新 mtime
      - sorted_names：所有文件的相对路径排序后的 tuple（防漏文件）

    auto-resume 时如果 snapshot 完全没变 + agent 又说"已完成" →
    agent 很可能在空转 / 撒谎，立即 bail 不再浪费钱。
    """
    if not root or not root.exists():
        return (0, 0, 0.0, ())
    files = [p for p in root.rglob("*") if p.is_file()]
    total_size = 0
    max_mtime = 0.0
    names = []
    for p in files:
        try:
            st = p.stat()
            total_size += st.st_size
            if st.st_mtime > max_mtime:
                max_mtime = st.st_mtime
            names.append(str(p.relative_to(root)))
        except OSError:
            pass
    return (len(files), total_size, max_mtime, tuple(sorted(names)))


def _combined_snapshot(*roots: Path) -> tuple:
    """Merge file fingerprints across multiple watch roots (e.g. template_create)."""
    total_files = 0
    total_size = 0
    max_mtime = 0.0
    all_names: list[str] = []
    for root in roots:
        snap = _project_snapshot(root)
        total_files += snap[0]
        total_size += snap[1]
        max_mtime = max(max_mtime, snap[2])
        prefix = str(root)
        all_names.extend(f"{prefix}:{name}" for name in snap[3])
    return (total_files, total_size, max_mtime, tuple(sorted(all_names)))


def template_watch_roots(options: JobOptions | None, project_root: Path) -> list[Path]:
    """Roots to monitor for template_create progress (project + output + staging)."""
    if options is None or options.job_type != "template_create":
        return [project_root]
    from backend.db.session import SessionLocal  # noqa: PLC0415
    from backend.models import Template  # noqa: PLC0415
    from backend.paths import TEMPLATE_STAGING_DIR  # noqa: PLC0415

    roots: list[Path] = [project_root]
    if options.template_record_id:
        with SessionLocal() as s:
            row = s.get(Template, options.template_record_id)
            if row and row.storage_path:
                storage = Path(row.storage_path)
                if storage not in roots:
                    roots.append(storage)
    if options.template_staging_id:
        staging = TEMPLATE_STAGING_DIR / options.template_staging_id
        if staging not in roots:
            roots.append(staging)
    return roots


def build_initial_prompt(
    prompt: str,
    project_name: str,
    project_root: Path,
    upload_paths: list[str] | None = None,
    *,
    mount_path: str | None = None,
    host_prefix: str | None = None,
    options=None,
) -> str:
    """第一次启动时给 agent 的指令。

    Phase 2 新增：
      - 告诉 agent 它的 per-user project_root（`init <name> --dir <project_root>` 用）
      - 列出用户已上传的素材文件 + 建议的 import-sources --copy 命令

    docker 容器：传 `mount_path`（如 "/work"）+ `host_prefix`（如 host 上的
    `data/users/<uid>/` 绝对路径），prompt 里所有 host 路径会被替换为容器内路径。
    例：/Users/x/data/users/U1/projects/job_id → /work/projects/job_id
        /Users/x/data/users/U1/uploads/job_id/f.pdf → /work/uploads/job_id/f.pdf
    """
    from backend.api.schemas.job_options import (
        JobOptions,
        format_beautify_options_for_prompt,
        format_options_for_prompt,
    )
    from backend.app.templates import resolve_container_template_path

    if mount_path and host_prefix:
        # 容器内路径：把 prompt 里所有 host 路径换成 mount 路径
        project_root_str = str(project_root).replace(host_prefix, mount_path, 1)
        if upload_paths:
            upload_paths = [p.replace(host_prefix, mount_path) for p in upload_paths]
    else:
        project_root_str = str(project_root)

    opts: JobOptions | None = options
    is_beautify = opts is not None and opts.job_type == "beautify"
    is_template_create = opts is not None and opts.job_type == "template_create"

    if is_template_create:
        prompt_body = prompt
        if mount_path and host_prefix:
            prompt_body = translate_paths_for_container(prompt, Path(host_prefix))
        mp = mount_path or "/work"
        parts = [
            prompt_body,
            "",
            "重要约束：",
            "1. 这是模板库资产制作任务，不是用户 PPT 生成。",
            "2. 完成后在回复末尾单独一行写 TEMPLATE_CREATE_DONE。",
            "3. 不要启动 confirm_ui/server.py。",
            f"4. 容器内路径：用户数据在 {mp}/，分析工作区在 {mp}/template-staging/，"
            f"全局模板输出在 {mp}/global-templates/，个人模板输出在 {mp}/templates/。",
        ]
    elif is_beautify:
        parts = [
            "请先 read_file 读取 skills/ppt-master/workflows/routing.md，确认走 beautify 路线。",
            "然后 read_file 读取 skills/ppt-master/workflows/beautify-pptx.md，并严格按该工作流执行。",
            "",
            f"项目目录名使用: {project_name}",
            f"你的项目根目录（用 --dir 标志传给 project_manager init）: {project_root_str}",
            "",
            "【美化 PPT 执行步骤 — 必须按序】",
            "1. 按 beautify-pptx.md Step 3–4：init → import-sources（源 PPTX）→ 提取 identity / inventory",
            "2. 在写 design_spec / spec_lock 之前，执行 SKILL.md Step 3 模板安装：",
            "   cp -r <模板目录>/* <project_path>/templates/",
            "3. 硬约束覆盖 beautify 默认「继承源身份」行为：",
            "   - 内容：sources/<stem>.md 逐字 1:1",
            "   - 页数：等于源 slide 数",
            "   - 视觉身份：锁定为 templates/design_spec.md（模板），禁止继承源 theme/observed",
            "   - page_layouts：每源页从模板 SVG roster 选最匹配版式（content 可复用）",
            "4. 按 beautify-pptx.md Step 6–7：Executor → finalize_svg → svg_to_pptx 导出",
            "",
            "重要约束（无头 Web 环境）：",
            "1. 【不要】启动 confirm_ui/server.py（会阻塞挂死）。身份直接锁定为模板 design_spec。",
            "2. 跳过需要外部 API 的可选功能（缺 key 时用网络搜图或占位，不要因此失败）。",
            "3. 完成导出后明确告知 exports 下生成的 .pptx 路径。",
            "",
        ]
    else:
        parts = [
            "请先用 read_file 读取 skills/ppt-master/SKILL.md，然后严格按其工作流执行，"
            "为以下内容生成一份 PPT（默认格式 PPT 16:9；页数、风格、内容密度优先遵循下方「PPT 生成要求」，"
            "其次遵循用户内容描述，均未指定时再自行推荐）。",
            "",
            f"项目目录名使用: {project_name}",
            f"你的项目根目录（用 --dir 标志传给 project_manager init）: {project_root_str}",
            "",
            "重要约束（Phase 0 验证环境）：",
            "1. 八点确认（Step 4）已禁用：不要停下来等用户确认。直接采用你列出的推荐默认值"
            "（画布/页数/风格/配色/字体/图标/生图策略/导出格式），一气呵成跑完所有非阻塞步骤直到导出 pptx。"
            "【不要】启动 confirm_ui/server.py（它在无头模式下会阻塞挂死）。",
            "   若下方「PPT 生成要求」中用户已锁定 visual_style，Layer 2 视觉风格不得重新推荐或替换；"
            "spec_lock.md 必须写入该值，并 read_file 对应 visual-styles/{id}.md。",
            "2. 跳过需要外部 API 的可选功能（AI 生图可用网络搜图兜底，或用纯色/图标占位；不要因为缺 key 而失败）。",
            "3. 完成导出后明确告知 exports 下生成的 .pptx 路径。",
            "",
        ]

    if upload_paths:
        parts.append("用户已上传的素材文件（请用 import-sources --copy 导入到你的项目目录）:")
        for up in upload_paths:
            parts.append(f"  - {up}")
        parts.append("")
        parts.append(
            "建议的导入命令（先把 init 跑完拿到项目路径，把 <project_path> 替换成 init 输出的实际路径）:"
        )
        quoted = " ".join(f"'{p}'" for p in upload_paths)
        parts.append(
            f"  python3 skills/ppt-master/scripts/project_manager.py import-sources "
            f"<project_path> {quoted} --copy"
        )
        parts.append("")

    if opts is not None:
        if is_beautify and opts.template is not None:
            owner_id = None
            if opts.template.scope == "user" and host_prefix:
                # host_prefix = data/users/<uid>
                owner_id = Path(host_prefix).name
            container_path = resolve_container_template_path(
                opts.template.scope,
                opts.template.kind,
                opts.template.id,
                user_id=owner_id,
            )
            parts.append(format_beautify_options_for_prompt(opts, container_template_path=container_path))
            parts.append("")
            parts.append("模板安装命令示例：")
            parts.append(f"  cp -r {container_path}/* <project_path>/templates/")
            parts.append("")
        elif not is_template_create:
            parts.append(format_options_for_prompt(opts))
            parts.append("")

    if not is_template_create:
        parts.append("用户内容：")
        parts.append(prompt)
    return "\n".join(parts)


