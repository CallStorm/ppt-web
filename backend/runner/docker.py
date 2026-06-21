"""Docker runner command construction."""
from __future__ import annotations

import logging
import subprocess
import threading
import uuid
from pathlib import Path

from backend.config import build_claude_env, get_runtime_config

log = logging.getLogger("backend.runner.docker")


def container_name_for(job_id: str) -> str:
    return f"ppt-job-{job_id}"


def stop_job_container(job_id: str, timeout: int = 30) -> bool:
    """Stop a job container by name. Returns True if docker stop succeeded."""
    name = container_name_for(job_id)
    try:
        r = subprocess.run(
            ["docker", "stop", "-t", str(timeout), name],
            timeout=timeout + 5,
            check=False,
            capture_output=True,
            text=True,
        )
        if r.returncode == 0:
            log.info("stopped container %s for job %s", name, job_id)
            return True
        return False
    except Exception as e:
        log.warning("docker stop failed for %s: %s", name, e)
        return False


def check_docker_runner_ready(image: str | None = None) -> str | None:
    """Return None if docker daemon and runner image are available, else error message."""
    cfg = get_runtime_config()
    img = image or cfg.docker.image
    try:
        r = subprocess.run(
            ["docker", "info"],
            timeout=10,
            check=False,
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            return "Docker daemon is not available (docker info failed)"
    except FileNotFoundError:
        return "docker CLI not found; install Docker and ensure it is on PATH"
    except subprocess.TimeoutExpired:
        return "docker info timed out"
    except Exception as e:
        return f"docker info failed: {e}"

    try:
        r = subprocess.run(
            ["docker", "image", "inspect", img],
            timeout=10,
            check=False,
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            return (
                f"Docker image {img!r} not found; "
                "run: bash docker/ppt-runner/build.sh"
            )
    except Exception as e:
        return f"docker image inspect failed: {e}"
    return None


def _split_claude_args(args: list[str]) -> tuple[str, list[str]]:
    """把 args 拆成 (prompt_text, extra_args)。

    claude CLI 的 -p <prompt> 必须单独成一项，从 args 抽出来。
    其余 flag（--output-format/--verbose/--resume/--dangerously-skip-permissions 等）
    原样返回，由 entrypoint.sh 拼回去。
    """
    prompt_text = ""
    extra: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == "-p" and i + 1 < len(args):
            prompt_text = args[i + 1]
            i += 2
        else:
            extra.append(args[i])
            i += 1
    return prompt_text, extra


def _build_docker_run_cmd(
    args: list[str],
    project_root: Path,
    job_id: str | None,
) -> tuple[list[str], str, str]:
    """构造 docker run 命令，env 透传 ANTHROPIC_* + PROMPT + EXTRA。

    容器内：/opt/ppt-master 是 ppt-master 源码（image 内），/work 是 host 的
    `data/users/<uid>/` 整目录（包含 projects/<job_id>/ 和 uploads/<job_id>/）。
    这样 ppt-master 的 project_manager --dir 写到 /work/projects/...，agent
    import-sources 也能从 /work/uploads/... 读到用户上传。

    返回 (cmd, mount_path, host_prefix)，后两个用于把 prompt 里的 host 路径
    翻译成容器内路径。
    """
    prompt_text, extra_args = _split_claude_args(args)
    container_name = (
        container_name_for(job_id) if job_id
        else f"ppt-job-{uuid.uuid4().hex[:8]}"
    )

    user_dir = project_root.resolve().parent.parent
    mount_path = "/work"
    host_prefix = str(user_dir)

    cfg = get_runtime_config()
    cmd: list[str] = [
        "docker", "run", "--rm", "-i",
        "--name", container_name,
        "--memory", cfg.docker.memory,
        "--cpus", cfg.docker.cpus,
        "--network", cfg.docker.network,
        "-v", f"{user_dir}:{mount_path}",
        "-w", "/opt/ppt-master",
        "-e", f"PROMPT={prompt_text}",
        "-e", f"JOB_ID={job_id or ''}",
    ]
    if extra_args:
        cmd.extend(["-e", f"CLAUDE_EXTRA_ARGS={' '.join(extra_args)}"])

    for k, v in build_claude_env().items():
        cmd.extend(["-e", f"{k}={v}"])

    cmd.append(cfg.docker.image)
    return cmd, mount_path, host_prefix


def _start_docker_watchdog(
    cancel_event: threading.Event,
    timeout_s: int,
    container_name: str | None,
) -> threading.Timer:
    """起一个 watchdog：超时后 set cancel_event，并 docker stop 容器（如果还在）。"""
    def _fire():
        log.warning(
            "docker runner timeout %ds reached for %s; cancelling",
            timeout_s, container_name or "?",
        )
        cancel_event.set()
        if container_name:
            try:
                subprocess.run(
                    ["docker", "stop", "-t", "30", container_name],
                    timeout=35, check=False, capture_output=True,
                )
            except Exception as e:
                log.warning("docker stop failed: %s", e)
    t = threading.Timer(timeout_s, _fire)
    t.daemon = True
    t.start()
    return t

