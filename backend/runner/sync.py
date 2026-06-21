"""Synchronous high-level run/resume wrappers."""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Callable

from backend.api.schemas.job_options import JobOptions, parse_job_options
from backend.runner.claude import stream_claude
from backend.runner.constants import AUTO_CONFIRM_TEXT, SKIP_EIGHT_CONFIRM_MAX
from backend.runner.stages import _project_snapshot, find_pptx, resolve_project_dir, build_initial_prompt

log = logging.getLogger("backend.runner.sync")

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
            "error_message": str(e),
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
    pptx = find_pptx(project_root)
    cost = result.get("total_cost_usd")
    stop_reason = result.get("stop_reason", "end_turn")

    # 八点确认已禁用，永远自动跳过（兜底：如果 agent 还是停下等用户，auto-resume 让它继续）
    effective_skip = True
    # 兼容第三方 API（minimaxi 等）的 stop_reason 行为：agent 主动停下等用户时
    # 官方 anthropic 返回 "end_turn"，但有些代理返回 None。一律当"主动停下"处理。
    STOP_OK = ("end_turn", None)
    no_progress_bail = False  # agent 没产生新文件 → bail，触发 refund
    if not pptx and stop_reason in STOP_OK and session_id:
        prev_snapshot = _project_snapshot(project_root)
        auto_round = 0
        while (
            not pptx
            and stop_reason in STOP_OK
            and auto_round < SKIP_EIGHT_CONFIRM_MAX
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
                    "error_message": str(e),
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
            pptx = find_pptx(project_root)
            project_dir = resolve_project_dir(project_name, root=project_root) or project_dir

            # 进展检测：snapshot 完全没变 + 仍然没 pptx → agent 在空转 / 撒谎。
            # 实测过：claude agent 把路径里的 user_id UUID 截断一位，然后说"导出完成 69KB"，
            # 反复 3 轮 auto-resume 烧掉 ~$1.14 才认命。snapshot 不变 = 必 bail。
            new_snapshot = _project_snapshot(project_root)
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

    if pptx:
        status = "done"
    elif no_progress_bail:
        # auto-resume 检测到 snapshot 完全没变 → agent 在空转 / 撒谎。
        # 标 failed + 触发 refund（不是用户 prompt 的问题，是 server 没识别出 agent 异常）
        status = "failed"
    elif stop_reason in STOP_OK:
        # agent 主动停下但还没出 pptx = 暂停等确认
        status = "paused"
    else:
        status = "failed"

    final = {
        "status": status,
        "session_id": session_id,
        "project_dir": str(project_dir) if project_dir else None,
        "pptx_path": str(pptx) if pptx else None,
        "cost_usd": cost,
        "last_agent_text": last_text,
        "error_message": (
            None if status != "failed" else
            ("auto-resume bailed: no file changes after multiple rounds; agent likely hallucinated"
             if no_progress_bail else f"stop_reason={stop_reason}")
        ),
        # run_job 看这个标志决定是否 refund credit
        "refund": no_progress_bail,
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
            "error_message": str(e),
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
    # 找产物：用 run 时已经记下的 project_root（per-user 隔离）
    project_dir = resolve_project_dir(project_name, root=project_root)
    pptx = find_pptx(project_root)

    if pptx:
        status = "done"
    elif stop_reason in ("end_turn", None):
        status = "paused"
    else:
        status = "failed"

    final = {
        "status": status,
        "session_id": session_id,
        "project_dir": str(project_dir) if project_dir else None,
        "pptx_path": str(pptx) if pptx else None,
        "cost_usd": cost,
        "last_agent_text": last_text,
        "error_message": None if status != "failed" else f"stop_reason={stop_reason}",
    }
    on_event({"kind": "status", "status": status})
    return final


