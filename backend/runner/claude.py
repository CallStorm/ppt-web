"""Claude CLI stream-json subprocess runner."""
from __future__ import annotations

import json
import logging
import subprocess
import threading
from pathlib import Path
from typing import Callable

from backend.config import get_runtime_config
from backend.runner.constants import PPTMASTER
from backend.runner.docker import (
    _build_docker_run_cmd,
    _start_docker_watchdog,
    container_name_for,
)
from backend.runner.stages import SPEC_RE, classify_stage

log = logging.getLogger("backend.runner.claude")

def stream_claude(
    args: list[str],
    on_event: Callable[[dict], None],
    cancel_event: threading.Event | None = None,
    proc_holder: list | None = None,
    project_root: Path | None = None,
    job_id: str | None = None,
) -> dict:
    """启动 claude CLI（stream-json），逐行解析事件，调用 on_event(event_dict)。

    每 job 一个 docker run 容器（自动 --rm），claude 在容器内执行。

    返回最终的 result 事件（含 session_id / cost / result 文本）。
    同步函数（Web 侧用 asyncio.to_thread 包装）。

    cancel_event: 外部可 set() 来请求取消；本函数会 terminate 子进程并退出循环。
    proc_holder: 若传一个 list，函数会把 Popen 引用放进去，便于外部做更细的控制。
    project_root: 必传（mount 进容器）
    job_id: 用于容器名 + 日志关联
    """
    if project_root is None:
        raise ValueError("project_root is required")

    cfg = get_runtime_config()
    cmd, _mount_path, _host_prefix = _build_docker_run_cmd(args, project_root, job_id)
    container_name = container_name_for(job_id) if job_id else cmd[cmd.index("--name") + 1]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    if proc_holder is not None:
        proc_holder.append(proc)

    watchdog: threading.Timer | None = None
    if cancel_event is not None:
        watchdog = _start_docker_watchdog(
            cancel_event, cfg.docker.timeout_s, container_name,
        )

    final_result: dict = {}
    last_assistant_text = ""
    cancelled = False
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            if cancel_event is not None and cancel_event.is_set():
                cancelled = True
                break
            line = line.strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                continue

            etype = evt.get("type")
            if etype == "assistant":
                content = evt.get("message", {}).get("content", [])
                for block in content:
                    btype = block.get("type")
                    if btype == "text":
                        last_assistant_text = block.get("text", "")
                        on_event({"kind": "agent_text", "text": last_assistant_text})
                    elif btype == "tool_use":
                        name = block.get("name", "")
                        inp = block.get("input", {}) or {}
                        cmd = inp.get("command", "") if isinstance(inp, dict) else ""
                        fpath = inp.get("file_path", "") if isinstance(inp, dict) else ""
                        # 区分 Read vs Write（修 spec_lock 误标 bug）
                        write_flag: bool | None
                        if name == "Write":
                            write_flag = True
                        elif name == "Read":
                            write_flag = False
                        else:
                            write_flag = None
                        stage = classify_stage(cmd, fpath, write=write_flag)
                        on_event({
                            "kind": "tool",
                            "tool": name,
                            "command": cmd,
                            "file_path": fpath,
                            "stage": stage,
                        })
                        # agent 写 spec 文件时，前端可能要拉取完整 spec 内容
                        if write_flag and fpath and SPEC_RE.search(fpath):
                            spec_path = PPTMASTER / fpath if not Path(fpath).is_absolute() else Path(fpath)
                            if spec_path.exists():
                                on_event({
                                    "kind": "spec",
                                    "design_spec": (spec_path.read_text(encoding="utf-8")
                                                    if spec_path.name == "design_spec.md" else None),
                                    "spec_lock": (spec_path.read_text(encoding="utf-8")
                                                  if spec_path.name == "spec_lock.md" else None),
                                })
            elif etype == "result":
                final_result = evt
                on_event({"kind": "result", "result": evt})

        if cancel_event is not None and cancel_event.is_set():
            cancelled = True
        proc.wait()
    finally:
        if watchdog is not None:
            watchdog.cancel()
        if cancelled and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        if proc.poll() is None:
            proc.kill()
        err = proc.stderr.read() if proc.stderr else ""
        if err.strip():
            on_event({"kind": "error", "message": err.strip()[-2000:]})

    final_result["_last_assistant_text"] = last_assistant_text
    final_result["_cancelled"] = cancelled
    return final_result

