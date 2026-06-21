"""Pipeline stage classification and project path helpers."""
from __future__ import annotations

import re
from pathlib import Path

STAGE_RULES: list[tuple[callable, str]] = [
    (lambda c, f, w: "source_to_md" in c, "1 解析素材"),
    (lambda c, f, w: "project_manager.py init" in c or "project_manager.py import" in c, "2 建项目"),
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
    所以不能直接用 <name>，要按前缀 glob 在 root/projects/ 下找真实目录（取最新）。

    Phase 2: root 是 per-user project_root（`data/users/<uid>/projects/<job_id>/`），
    ppt-master init 会把 `<name>_<format>_<date>/` 建在 `<root>/projects/` 下。
    """
    base = root / "projects"
    if not base.exists():
        return None
    hits = sorted(
        [p for p in base.iterdir() if p.is_dir() and p.name.startswith(project_name)],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return hits[0] if hits else None


def find_pptx(root: Path) -> Path | None:
    """在 per-user project_root 下递归找最新导出的 pptx。

    root 是 `data/users/<uid>/projects/<job_id>/`，pptx 通常在
    `<root>/projects/<name>_<format>_<date>/exports/*.pptx`。
    """
    if not root or not root.exists():
        return None
    hits = sorted(root.rglob("*.pptx"), key=lambda p: p.stat().st_mtime, reverse=True)
    return hits[0] if hits else None


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
    if mount_path and host_prefix:
        # 容器内路径：把 prompt 里所有 host 路径换成 mount 路径
        project_root_str = str(project_root).replace(host_prefix, mount_path, 1)
        if upload_paths:
            upload_paths = [p.replace(host_prefix, mount_path) for p in upload_paths]
    else:
        project_root_str = str(project_root)
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
    if options is not None:
        from backend.api.schemas.job_options import format_options_for_prompt

        parts.append(format_options_for_prompt(options))
        parts.append("")
    parts.append("用户内容：")
    parts.append(prompt)
    return "\n".join(parts)


