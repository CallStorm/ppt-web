"""Revision (post-completion modification) pipeline.

When the user clicks "Edit" on a done job, this module:

  1. Validates the source job (status==done, has project_dir on disk).
  2. Creates a new job row in 'queued' state with revision_of_job_id
     pointing at the source. The new job is owned by the same user and
     inherits project_name + options.
  3. Copies the source's project_dir into the new job's project_root
     (so the agent's filesystem view is self-contained).
  4. Constructs the modification prompt (with a fallback template for
     the no-session case, see ``_build_revision_prompt``).
  5. Decrements the user's quota_credits by 1 and writes pending_confirm
     so the dispatcher picks it up and runs ``claude --resume <sid> -p``.

Why a new job, not in-place mutation
------------------------------------
A single ``session_id`` is a linear progression in the LLM. Mixing the
"create" run and a "modify" run on the same row would surface the
intermediate state in the UI in a confusing way. A new job gives the
revision its own status / cost / events / cancel, and lets the
revision_of_job_id field give the UI a clean "v2" link.

Why a copy of project_dir
-------------------------
Docker mounts the new job's project_root into the container. The source
project_dir lives under a different job_id subtree, so without copying
the agent would not see the original SVGs / images / exports. We copy
(``shutil.copytree``) so the new run is fully isolated; on failure we
can simply delete the copy without touching the source.
"""
from __future__ import annotations

import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Sequence

from backend.api.schemas.job_options import RevisionItem
from backend.paths import project_root_for


def _SessionLocal():
    """Late-bound SessionLocal so this module can be imported on Python
    3.14 / SQLAlchemy 2.x test environments without paying the
    model-registration cost (which trips a 3.14 typing.Union bug)."""
    from backend.db.session import SessionLocal as _SL
    return _SL

log = logging.getLogger("backend.runtime.revisions")

# Names of artifacts that the agent's edit/write work does NOT need to
# see. Kept small to keep the revision copy fast; expand if needed.
_COPY_IGNORE_DIRS: tuple[str, ...] = (
    "__pycache__",
    ".git",
    "node_modules",
    "venv",
    ".venv",
)

_COPY_IGNORE_FILES: tuple[str, ...] = (
    "a.out",  # accidental build artifacts occasionally land in project dirs
)


def copy_project_dir(src: Path, dst_root: Path, project_name: str) -> Path:
    """Copy the entire ``src`` project directory into ``dst_root/<project_name>``.

    Returns the new path. ``dst_root`` is the per-user
    ``data/users/<uid>/projects/<new_job_id>/`` — the agent's mount root.
    """
    if not src.is_dir():
        raise FileNotFoundError(f"source project_dir does not exist: {src}")
    dst = dst_root / project_name
    if dst.exists():
        # Idempotency: if a previous attempt left a copy behind, blow it
        # away. We never want a half-copy to leak into a new revision.
        shutil.rmtree(dst, ignore_errors=True)

    def _ignore(_dir: str, names: Sequence[str]) -> list[str]:
        ignored: list[str] = []
        for n in names:
            if n in _COPY_IGNORE_DIRS:
                ignored.append(n)
            elif n in _COPY_IGNORE_FILES:
                ignored.append(n)
        return ignored

    shutil.copytree(
        src,
        dst,
        symlinks=False,
        ignore=_ignore,
        ignore_dangling_symlinks=True,
    )
    return dst


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------


def _format_items_for_prompt(
    items: list[RevisionItem],
    slide_lookup: dict[int, str] | None = None,
) -> str:
    """Render each comment as ``- 第 N 页（<name>）: <comment>`` if we have
    a name lookup, else just ``- 第 N 页: <comment>``."""
    lines: list[str] = []
    for it in items:
        if slide_lookup and it.slide_index in slide_lookup:
            lines.append(
                f"- 第 {it.slide_index} 页（{slide_lookup[it.slide_index]}）: {it.comment}"
            )
        else:
            lines.append(f"- 第 {it.slide_index} 页: {it.comment}")
    return "\n".join(lines)


def _build_revision_prompt(
    old_job_id: str,
    items: list[RevisionItem],
    has_session: bool,
    slide_names: dict[int, str] | None,
) -> str:
    """Build the user-facing prompt that the agent will read.

    The same template serves both "small edit" (tweak a label) and
    "large edit" (replace an image, redraw a layout) — the agent decides
    based on the comment. We do NOT distinguish the two on the wire.
    """
    items_text = _format_items_for_prompt(items, slide_names)
    if has_session:
        # ── Standard path: full session history is available ──
        return (
            f"用户对已完成 PPT (job {old_job_id}) 提出如下修改意见，请只改这些页、保留其它页字面不动：\n\n"
            f"{items_text}\n\n"
            "操作步骤：\n"
            "1. 用 Read 工具读对应页的 svg_output/page_XX_*.svg 全文（如有引用图片一起读）\n"
            "2. 根据意见的轻重，自行判断：\n"
            "   - 若是文案/数字/颜色的微调 → 用 Edit 工具小改后存回原文件\n"
            "   - 若是换图、换图标、调整布局 → 用 Write 工具整页重画\n"
            "3. 改完跑：\n"
            "   `python3 skills/ppt-master/scripts/finalize_svg.py <project_dir>`\n"
            "   让 svg_final/ 与 svg_output/ 同步（这步会自动修坏命名空间，不需要手动检查）\n"
            "4. 跑：\n"
            "   `python3 skills/ppt-master/scripts/svg_to_pptx.py <project_dir>`\n"
            "   重新导出 pptx 覆盖原文件\n"
            "5. 完成后只回复「修改完成」四个字，结束本轮\n\n"
            "硬性约束：\n"
            "- 不要修改用户未提及的页（即使你看到可以更漂亮的地方）\n"
            "- 不要重新调用 image_search / image_gen 选新图（除非用户意见里明确要求换图）\n"
            "- 不要进入 Eight Confirmations 等需要用户交互的环节\n"
            "- 这一轮只跑一次；想再改就让用户重新提交\n"
        )
    # ── Degraded path: no session_id (container restart, etc.) ──
    return (
        f"用户对已完成 PPT (job {old_job_id}) 提出修改意见。注意：原 session 不可用，"
        f"你拿不到之前的完整对话历史；已自动放行，让你基于当前 project_dir 自助修改。\n\n"
        f"修改意见：\n{items_text}\n\n"
        "操作步骤：\n"
        "1. 用 Read 工具读 design_spec.md / spec_lock.md（如存在）了解原 deck 的结构与风格\n"
        "2. 读 svg_output/ 下的全部 SVG 自己建立上下文\n"
        "3. 仅修改用户列出的页；保留其它页字面不动\n"
        "4. 跑：\n"
        "   `python3 skills/ppt-master/scripts/finalize_svg.py <project_dir>`\n"
        "   `python3 skills/ppt-master/scripts/svg_to_pptx.py <project_dir>`\n"
        "5. 完成后只回复「修改完成」四个字，结束本轮\n\n"
        "硬性约束：同上（不另开选图、不动未提及页、不进交互环节）\n"
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


class RevisionError(Exception):
    """User-visible error from queue_revision. Subclassed to keep the
    route handler's error translation simple."""


def queue_revision(
    *,
    old_job_id: str,
    items: list[RevisionItem],
    user_id: str,
    slide_names: dict[int, str] | None = None,
) -> str:
    """Validate, copy project_dir, create a new job, deduct credit, queue
    a resume. Returns the new job's id. Raises ``RevisionError`` on
    validation failures (no credit, source not done, no project_dir, …).
    """
    # Both ``Job`` and ``User`` are imported lazily here so that the
    # module can be loaded (and unit-tested) in environments where the
    # SQLAlchemy 2.0 + Python 3.14 typing.Union path is broken. Tests
    # patch ``_SessionLocal`` and ``notify_dispatcher`` and never reach
    # the real ``backend.models`` import.
    from backend.models import Job, User  # noqa: WPS433

    if not items:
        raise RevisionError("at least one revision item is required")

    new_job_id = str(uuid.uuid4())
    log.info("queue_revision: old=%s new=%s user=%s items=%d",
             old_job_id, new_job_id, user_id, len(items))

    with _SessionLocal()() as s:
        old = s.get(Job, old_job_id)
        if not old:
            raise RevisionError(f"source job {old_job_id} not found")
        if old.user_id != user_id:
            raise RevisionError("source job does not belong to this user")
        if old.status != "done":
            raise RevisionError(
                f"source job status is {old.status!r}; only 'done' jobs are editable"
            )
        if not old.project_dir or not Path(old.project_dir).is_dir():
            raise RevisionError(
                "source job's project_dir is missing on disk; cannot edit"
            )

        # ── Deduct credit BEFORE any filesystem work ──
        u = s.get(User, user_id)
        if not u:
            raise RevisionError("user not found")
        if u.quota_credits <= 0:
            raise RevisionError("quota exhausted; cannot start revision")
        u.quota_credits -= 1

        # ── Compose options: inherit from old job, then attach revision_items ──
        try:
            old_opts = json.loads(old.options_json) if old.options_json else {}
        except json.JSONDecodeError:
            old_opts = {}
        # Strip any revision_items the parent might have had — only this
        # job's items matter.
        old_opts.pop("revision_items", None)
        old_opts["revision_items"] = [it.model_dump() for it in items]
        new_options_json = json.dumps(old_opts, ensure_ascii=False)

        # Project name gets a -r2 / -r3 suffix so it doesn't clash with
        # the parent's project_dir (which lives in a different job root).
        new_project_name = f"{old.project_name}-r{_revision_index(old, s) + 2}"

        # ── Create the new job row in queued state ──
        s.add(Job(
            id=new_job_id,
            user_id=user_id,
            prompt=_build_revision_prompt(
                old_job_id=old_job_id,
                items=items,
                has_session=bool(old.session_id),
                slide_names=slide_names,
            ),
            project_name=new_project_name,
            status="queued",
            require_confirm=False,
            options_json=new_options_json,
            session_id=old.session_id,  # resume target
            revision_of_job_id=old.id,
        ))
        s.commit()

    # ── Copy the project_dir into the new job's project_root ──
    new_root = project_root_for(user_id, new_job_id)
    new_root.mkdir(parents=True, exist_ok=True)
    try:
        new_project_dir = copy_project_dir(
            src=Path(old.project_dir),
            dst_root=new_root,
            project_name=new_project_name,
        )
    except Exception as e:
        # Roll back the credit + mark job failed so we don't leak a queued
        # job that the dispatcher will pick up against a missing dir.
        log.error("copy_project_dir failed for %s: %s", new_job_id, e)
        with _SessionLocal()() as s:
            j = s.get(Job, new_job_id)
            if j:
                j.status = "failed"
                j.error_message = f"failed to copy project_dir: {e}"
                s.commit()
            u = s.get(User, user_id)
            if u:
                u.quota_credits += 1
                s.commit()
        raise RevisionError(f"failed to copy source deck: {e}") from e

    # ── Persist the new project_dir on the job so /preview finds it ──
    with _SessionLocal()() as s:
        j = s.get(Job, new_job_id)
        if j:
            j.project_dir = str(new_project_dir)
            s.commit()

    # ── Wake the dispatcher (it will pick up the new queued job) ──
    _notify_dispatcher()
    return new_job_id


def _notify_dispatcher() -> None:
    """Module-level indirection for the dispatcher wake. The real call
    pulls in ``backend.runtime.jobs`` lazily, so unit tests can patch
    this function without triggering that import chain."""
    from backend.runtime.jobs import notify_dispatcher
    notify_dispatcher()


def _revision_index(parent, s) -> int:
    """Return the number of revisions already created against ``parent``
    (1 = first revision will be r2). Used to suffix the project name.
    """
    from backend.models import Job  # noqa: WPS433
    count = (
        s.query(Job)
        .filter(Job.revision_of_job_id == parent.id)
        .count()
    )
    return count
