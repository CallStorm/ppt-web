"""Synchronous high-level run/resume wrappers."""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Callable

from backend.api.schemas.job_options import JobOptions, parse_job_options
from backend.runner.claude import stream_claude
from backend.runner.constants import AUTO_CONFIRM_TEXT, SKIP_EIGHT_CONFIRM_MAX
from backend.runner.stages import (
    _combined_snapshot,
    _project_snapshot,
    beautify_output_ready,
    find_pptx,
    resolve_project_dir,
    build_initial_prompt,
    template_watch_roots,
)
from backend.runner.errors import humanize_error

log = logging.getLogger("backend.runner.sync")


def _humanize_run_error(raw: str | None, job_id: str | None) -> str | None:
    """Log the raw error with job_id, return the humanized version."""
    if raw:
        log.warning("job %s failed raw error: %s", job_id, raw)
    return humanize_error(raw)


def _resolve_pptx(
    project_root: Path,
    project_name: str,
    project_dir: Path | None,
    options: JobOptions | None,
) -> tuple[Path | None, str | None]:
    """Find export PPTX and apply beautify completion rules."""
    is_beautify = options is not None and options.job_type == "beautify"
    pptx = find_pptx(
        project_root,
        project_name=project_name,
        beautify=is_beautify,
    )
    if not is_beautify:
        return pptx, None
    if not pptx:
        return None, "no exported pptx in exports/"
    ready, err = beautify_output_ready(project_dir)
    if ready:
        return pptx, None
    return None, err or "beautify output incomplete"


def _finalize_status(
    *,
    pptx: Path | None,
    pptx_error: str | None,
    options: JobOptions | None,
    stop_reason,
    session_id,
    no_progress_bail: bool,
    last_text: str | None = None,
) -> tuple[str, Path | None, str | None, bool]:
    """Return (status, pptx_path, error_message, refund)."""
    is_template_create = options is not None and options.job_type == "template_create"
    STOP_OK = ("end_turn", None)

    if pptx_error:
        return "failed", None, pptx_error, no_progress_bail
    if pptx:
        return "done", pptx, None, False
    if is_template_create and options is not None:
        from backend.app.template_service import template_output_ready  # noqa: PLC0415

        if template_output_ready(options.template_record_id, None):
            return "done", None, None, False
        return "failed", None, "template output incomplete", no_progress_bail
    if no_progress_bail:
        return (
            "failed",
            None,
            "auto-resume bailed: no file changes after multiple rounds; agent likely hallucinated",
            True,
        )
    if stop_reason in STOP_OK and session_id:
        return "paused", None, None, False
    if stop_reason in STOP_OK and not session_id:
        return "failed", None, "session lost: cannot resume confirmation", False
    return "failed", None, f"stop_reason={stop_reason}", no_progress_bail


def run_sync(
    prompt: str,
    project_name: str,
    project_root: Path,
    on_event: Callable[[dict], None],
    *,
    upload_paths: list[str] | None = None,
    cancel_event: threading.Event | None = None,
    proc_holder: list | None = None,
    require_confirm: bool = False,
    job_id: str | None = None,
    options: JobOptions | None = None,
) -> dict:
    """组装 args → 调 stream_claude → 判 paused/done → 返回结果 dict。

    返回的 dict 含：status (done|paused|failed|cancelled), session_id, project_dir,
    pptx_path, cost_usd, last_agent_text。

    `require_confirm`：
      True  → stage 3 end_turn 时切 paused（弹 UI 确认面板）
      False → 自动 --resume + 喂 AUTO_CONFIRM_TEXT 继续（除非 env SKIP_EIGHT_CONFIRM 关掉）
              全局 env `SKIP_EIGHT_CONFIRM=true` 仍然可以强制覆盖 → 永远自动 resume。
    """
    user_dir = project_root.resolve().parent.parent
    full_prompt = build_initial_prompt(
        prompt, project_name, project_root,
        upload_paths=upload_paths,
        mount_path="/work",
        host_prefix=str(user_dir),
        options=options,
    )
    args = [
        "-p", full_prompt,
        "--output-format", "stream-json",
        "--input-format", "text",
        "--verbose",
        "--dangerously-skip-permissions",
    ]
    on_event({"kind": "status", "status": "running"})

    try:
        result = stream_claude(
            args, on_event,
            cancel_event=cancel_event, proc_holder=proc_holder,
            project_root=project_root, job_id=job_id,
        )
    except Exception as e:
        on_event({"kind": "error", "message": f"claude CLI 失败: {e}"})
        return {
            "status": "failed",
            "session_id": None,
            "project_dir": None,
            "pptx_path": None,
            "cost_usd": None,
            "last_agent_text": None,
            "error_message": _humanize_run_error(f"claude CLI 失败: {e}", job_id),
        }

    if result.get("_cancelled"):
        return {
            "status": "cancelled",
            "session_id": result.get("session_id"),
            "project_dir": None,
            "pptx_path": None,
            "cost_usd": result.get("total_cost_usd"),
            "last_agent_text": result.get("_last_assistant_text", ""),
            "error_message": "user cancelled",
        }

    session_id = result.get("session_id")
    last_text = result.get("_last_assistant_text", "")

    # 找产物（per-user project_root）
    project_dir = resolve_project_dir(project_name, root=project_root)
    pptx, pptx_error = _resolve_pptx(project_root, project_name, project_dir, options)
    cost = result.get("total_cost_usd")
    stop_reason = result.get("stop_reason", "end_turn")

    # 八点确认已禁用，永远自动跳过（兜底：如果 agent 还是停下等用户，auto-resume 让它继续）
    effective_skip = True
    # 兼容第三方 API（minimaxi 等）的 stop_reason 行为：agent 主动停下等用户时
    # 官方 anthropic 返回 "end_turn"，但有些代理返回 None。一律当"主动停下"处理。
    STOP_OK = ("end_turn", None)
    no_progress_bail = False  # agent 没产生新文件 → bail，触发 refund
    is_template_create = options is not None and options.job_type == "template_create"

    def _template_done(_text: str | None = None) -> bool:
        if not is_template_create or options is None:
            return False
        from backend.app.template_service import template_output_ready  # noqa: PLC0415

        return template_output_ready(options.template_record_id, None)

    def _take_snapshot() -> tuple:
        if is_template_create:
            return _combined_snapshot(*template_watch_roots(options, project_root))
        return _project_snapshot(project_root)

    template_already_ready = _template_done() if is_template_create else False

    if (
        not template_already_ready
        and not pptx
        and stop_reason in STOP_OK
        and session_id
        and not _template_done(last_text)
    ):
        prev_snapshot = _take_snapshot()
        auto_round = 0
        while (
            not pptx
            and stop_reason in STOP_OK
            and auto_round < SKIP_EIGHT_CONFIRM_MAX
            and not _template_done(last_text)
        ):
            if cancel_event is not None and cancel_event.is_set():
                break
            auto_round += 1
            log.info(
                "SKIP_EIGHT_CONFIRM auto-resume round %d/%d for session %s",
                auto_round, SKIP_EIGHT_CONFIRM_MAX, session_id,
            )
            on_event({"kind": "status", "status": "running", "auto_confirm": True})
            resume_args = [
                "--resume", session_id,
                "-p", AUTO_CONFIRM_TEXT,
                "--output-format", "stream-json",
                "--input-format", "text",
                "--verbose",
                "--dangerously-skip-permissions",
            ]
            try:
                resume_result = stream_claude(
                    resume_args, on_event,
                    cancel_event=cancel_event, proc_holder=proc_holder,
                    project_root=project_root, job_id=job_id,
                )
            except Exception as e:
                on_event({"kind": "error", "message": f"auto-resume claude CLI 失败: {e}"})
                return {
                    "status": "failed",
                    "session_id": session_id,
                    "project_dir": None,
                    "pptx_path": None,
                    "cost_usd": None,
                    "last_agent_text": None,
                    "error_message": _humanize_run_error(f"auto-resume claude CLI 失败: {e}", job_id),
                }
            if resume_result.get("_cancelled"):
                return {
                    "status": "cancelled",
                    "session_id": session_id,
                    "project_dir": None,
                    "pptx_path": None,
                    "cost_usd": resume_result.get("total_cost_usd"),
                    "last_agent_text": resume_result.get("_last_assistant_text", ""),
                    "error_message": "user cancelled",
                }
            # 累计 cost / 取最新 text / session_id / stop_reason / 产物
            last_text = resume_result.get("_last_assistant_text") or last_text
            cost = (cost or 0) + (resume_result.get("total_cost_usd") or 0)
            session_id = resume_result.get("session_id") or session_id
            stop_reason = resume_result.get("stop_reason", "end_turn")
            pptx, pptx_error = _resolve_pptx(
                project_root, project_name, project_dir, options,
            )
            project_dir = resolve_project_dir(project_name, root=project_root) or project_dir

            if _template_done(last_text):
                break

            # 进展检测：snapshot 完全没变 + 仍然没 pptx → agent 在空转 / 撒谎。
            # template_create 同时监控 storage_path / staging，避免误 bail。
            new_snapshot = _take_snapshot()
            if not pptx and new_snapshot == prev_snapshot:
                no_progress_bail = True
                log.warning(
                    "auto-resume round %d: project snapshot unchanged; agent not making progress; bail",
                    auto_round,
                )
                on_event({
                    "kind": "error",
                    "message": f"auto-resume: no file changes after round {auto_round}; agent likely stuck or hallucinating",
                })
                break
            prev_snapshot = new_snapshot
        log.info(
            "SKIP_EIGHT_CONFIRM finished after %d rounds: pptx=%s stop_reason=%s",
            auto_round, bool(pptx), stop_reason,
        )

    status, pptx, pptx_error, refund = _finalize_status(
        pptx=pptx,
        pptx_error=pptx_error,
        options=options,
        stop_reason=stop_reason,
        session_id=session_id,
        no_progress_bail=no_progress_bail,
        last_text=last_text,
    )

    final = {
        "status": status,
        "session_id": session_id,
        "project_dir": str(project_dir) if project_dir else None,
        "pptx_path": str(pptx) if pptx else None,
        "cost_usd": cost,
        "last_agent_text": last_text,
        "error_message": _humanize_run_error(pptx_error, job_id),
        # run_job 看这个标志决定是否 refund credit
        "refund": refund,
    }
    on_event({"kind": "status", "status": status})
    return final


def resume_sync(
    session_id: str,
    confirm: str,
    project_root: Path,
    project_name: str,
    on_event: Callable[[dict], None],
    *,
    cancel_event: threading.Event | None = None,
    proc_holder: list | None = None,
    job_id: str | None = None,
    options: JobOptions | None = None,
) -> dict:
    """注入用户确认继续 `--resume <session_id>`。返回同 run_sync。

    project_root: per-user project_root（与 run 时一致），用于找产物。
    project_name: 用于 resolve_project_dir 找最新子目录。
    """
    args = [
        "--resume", session_id,
        "-p", confirm,
        "--output-format", "stream-json",
        "--input-format", "text",
        "--verbose",
        "--dangerously-skip-permissions",
    ]
    on_event({"kind": "status", "status": "running"})

    try:
        result = stream_claude(
            args, on_event,
            cancel_event=cancel_event, proc_holder=proc_holder,
            project_root=project_root, job_id=job_id,
        )
    except Exception as e:
        on_event({"kind": "error", "message": f"claude CLI 失败: {e}"})
        return {
            "status": "failed",
            "session_id": session_id,
            "project_dir": None,
            "pptx_path": None,
            "cost_usd": None,
            "last_agent_text": None,
            "error_message": _humanize_run_error(f"claude CLI 失败: {e}", job_id),
        }

    if result.get("_cancelled"):
        return {
            "status": "cancelled",
            "session_id": session_id,
            "project_dir": None,
            "pptx_path": None,
            "cost_usd": result.get("total_cost_usd"),
            "last_agent_text": result.get("_last_assistant_text", ""),
            "error_message": "user cancelled",
        }

    last_text = result.get("_last_assistant_text", "")
    cost = result.get("total_cost_usd")
    stop_reason = result.get("stop_reason", "end_turn")
    project_dir = resolve_project_dir(project_name, root=project_root)
    pptx, pptx_error = _resolve_pptx(project_root, project_name, project_dir, options)

    if pptx_error:
        status = "failed"
        error_message = pptx_error
    elif pptx:
        status = "done"
        error_message = None
    elif stop_reason in ("end_turn", None):
        status = "paused"
        error_message = None
    else:
        status = "failed"
        error_message = f"stop_reason={stop_reason}"

    final = {
        "status": status,
        "session_id": session_id,
        "project_dir": str(project_dir) if project_dir else None,
        "pptx_path": str(pptx) if pptx else None,
        "cost_usd": cost,
        "last_agent_text": last_text,
        "error_message": _humanize_run_error(error_message, job_id),
    }
    on_event({"kind": "status", "status": status})
    return final


