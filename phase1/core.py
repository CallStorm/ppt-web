"""Phase 1 编排核心。

从 `phase0/orchestrator.py` 抽出，修复了 Read/Write 误标阶段 3 的 bug，
加了 active job 锁、fanout、async 入口。被 `phase0/orchestrator.py`（CLI 壳）
和 `phase1/server.py`（FastAPI）共同 import。

事件协议（on_event 收到的 dict）：
  - {"kind": "status",     "status": "running|paused|done|failed|cancelled"}
  - {"kind": "stage",      "stage":  "3 策略规划(八点确认)"}
  - {"kind": "tool",       "tool": "Bash|Read|Write|...", "command": ..., "file_path": ..., "stage": ...}
  - {"kind": "agent_text", "text":  "..."}
  - {"kind": "result",     "session_id": "...", "cost_usd": 2.38, "stop_reason": "end_turn",
                           "last_agent_text": "...", "project_dir": "...", "pptx_path": "..."}
  - {"kind": "spec",       "design_spec": "<md>", "spec_lock": "<md>"}
  - {"kind": "error",      "message": "..."}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("phase1.core")

from phase1.db import SessionLocal, init_db, _is_sqlite
from phase1.models import Event as DbEvent
from phase1.models import Job as DbJob
from phase1.models import User
from phase1.paths import project_root_for, uploads_dir_for
from sqlalchemy import literal_column

# ── 路径 ──────────────────────────────────────────────────────────────
# phase1/core.py 位于 phase1/，PROJECT_ROOT 是其父目录 = ppt-web/
HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
PPTMASTER = PROJECT_ROOT / "ppt-master"

# ── Docker 化执行（方案 2）────────────────────────────────────
# 每个 job 起一个临时容器跑 claude，--rm 自动销毁。
# 关掉 = 走老路直接 host 上 Popen("claude ...", cwd=PPTMASTER)，适合本地开发
# 打开 = uvicorn 通过 `docker run` 起容器，per-job 隔离
USE_DOCKER_RUNNER: bool = os.getenv("USE_DOCKER_RUNNER", "false").strip().lower() in ("1", "true", "yes", "on")
DOCKER_RUNNER_IMAGE: str = os.getenv("DOCKER_RUNNER_IMAGE", "ppt-runner:latest")
DOCKER_RUNNER_NETWORK: str = os.getenv("DOCKER_RUNNER_NETWORK", "ppt-isolated")
DOCKER_RUNNER_MEMORY: str = os.getenv("DOCKER_RUNNER_MEMORY", "4g")
DOCKER_RUNNER_CPUS: str = os.getenv("DOCKER_RUNNER_CPUS", "2")
# 单 job 容器最长跑多久（秒），超时强杀。claude 生成 10 页通常 5-15 分钟
DOCKER_RUNNER_TIMEOUT_S: int = int(os.getenv("DOCKER_RUNNER_TIMEOUT_S", "1800"))

# ── 八点确认（已禁用）───────────────────────────────────────────
# 八点确认功能已移除。prompt 改用"直接采用推荐默认值，不要等用户确认"，
# run_sync 永远 auto_skip 八点确认。这里保留 env 变量和常量仅作向后兼容。
SKIP_EIGHT_CONFIRM_MAX: int = int(os.getenv("SKIP_EIGHT_CONFIRM_MAX", "3"))
# 与 phase0/orchestrator.py:103 默认 confirm 文本保持一致（auto-resume 兜底用）
AUTO_CONFIRM_TEXT: str = "确认，按你的推荐方案继续生成。"
DATA_DIR = PROJECT_ROOT / "data"

# ── 流水线阶段映射 ───────────────────────────────────────────────────
# 把 agent 的工具调用映射到 ppt-master 的串行阶段。匹配第一个即采用。
# 修 Read/Write 误标：spec_lock.md 必须显式写时才命中阶段 3。
# 所有 match 统一收 (c, f, w) 三参——前两个忽略 w 也得能跑（不然 classify 里的
# 通用 try-call 会让前面的 2-arg lambda 抛 TypeError 被吞掉，永远走不到后面的规则）。
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
) -> str:
    """第一次启动时给 agent 的指令。

    Phase 2 新增：
      - 告诉 agent 它的 per-user project_root（`init <name> --dir <project_root>` 用）
      - 列出用户已上传的素材文件 + 建议的 import-sources --copy 命令

    docker 模式：传 `mount_path`（如 "/work"）+ `host_prefix`（如 host 上的
    `data/users/<uid>/` 绝对路径），prompt 里所有 host 路径会被替换为容器内路径。
    例：/Users/x/data/users/U1/projects/job_id → /work/projects/job_id
        /Users/x/data/users/U1/uploads/job_id/f.pdf → /work/uploads/job_id/f.pdf
    """
    if mount_path and host_prefix:
        # docker 模式：把 prompt 里所有 host 路径换成容器内路径
        project_root_str = str(project_root).replace(host_prefix, mount_path, 1)
        if upload_paths:
            upload_paths = [p.replace(host_prefix, mount_path) for p in upload_paths]
    else:
        project_root_str = str(project_root)
    parts = [
        "请先用 read_file 读取 skills/ppt-master/SKILL.md，然后严格按其工作流执行，"
        "为以下内容生成一份 PPT（默认格式 PPT 16:9；页数、风格、内容密度优先遵循用户描述，用户没写时再自行推荐）。",
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
    parts.append("用户内容：")
    parts.append(prompt)
    return "\n".join(parts)


# ── 子进程 stream-json ──────────────────────────────────────────────

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
        f"ppt-job-{job_id}" if job_id
        else f"ppt-job-{uuid.uuid4().hex[:8]}"
    )

    # 整个 user_dir 挂到 /work（包含 projects/<job_id> + uploads/<job_id>）
    # user_dir = project_root.parent.parent
    #   project_root = data/users/<uid>/projects/<job_id>
    #   parent       = data/users/<uid>/projects
    #   parent.parent= data/users/<uid>
    user_dir = project_root.resolve().parent.parent
    mount_path = "/work"
    host_prefix = str(user_dir)

    cmd: list[str] = [
        "docker", "run", "--rm", "-i",
        "--name", container_name,
        "--memory", DOCKER_RUNNER_MEMORY,
        "--cpus", DOCKER_RUNNER_CPUS,
        "--network", DOCKER_RUNNER_NETWORK,
        "-v", f"{user_dir}:{mount_path}",
        "-w", "/opt/ppt-master",
        "-e", f"PROMPT={prompt_text}",
        "-e", f"JOB_ID={job_id or ''}",
    ]
    if extra_args:
        cmd.extend(["-e", f"CLAUDE_EXTRA_ARGS={' '.join(extra_args)}"])

    # 透传 ANTHROPIC_* 等认证 env。
    # CLAUDE_CODE_EXECPATH 不传：host 上的路径（Mac /opt/homebrew/...）
    # 在 Linux 容器里没意义，会让 claude 找不到自己。
    # 透传所有 ANTHROPIC_* env（含 BASE_URL / MODEL / DEFAULT_*_MODEL 等）。
    for k, v in os.environ.items():
        if k == "CLAUDE_CODE_EXECPATH":
            continue
        if k.startswith("ANTHROPIC_"):
            cmd.extend(["-e", f"{k}={v}"])
    # third-party 代理（minimaxi/openrouter/azure 等）通常只用 ANTHROPIC_AUTH_TOKEN，
    # 但 claude CLI 默认只认 ANTHROPIC_API_KEY。容器里没 ~/.claude/ credentials，
    # 所以手动 alias 一下，确保容器里的 claude 一定能找到 key。
    if "ANTHROPIC_AUTH_TOKEN" in os.environ and "ANTHROPIC_API_KEY" not in os.environ:
        cmd.extend(["-e", f"ANTHROPIC_API_KEY={os.environ['ANTHROPIC_AUTH_TOKEN']}"])

    cmd.append(DOCKER_RUNNER_IMAGE)
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
        # docker stop 容器（如果还在跑），给 30s 优雅退出，再 SIGKILL
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


def stream_claude(
    args: list[str],
    on_event: Callable[[dict], None],
    cancel_event: threading.Event | None = None,
    proc_holder: list | None = None,
    project_root: Path | None = None,
    job_id: str | None = None,
) -> dict:
    """启动 claude CLI（stream-json），逐行解析事件，调用 on_event(event_dict)。

    USE_DOCKER_RUNNER=true 时改走 docker run（每 job 一个容器，自动 --rm）。
    否则 host 上 Popen("claude ...")，cwd=PPTMASTER（本地开发用）。

    返回最终的 result 事件（含 session_id / cost / result 文本）。
    同步函数（Web 侧用 asyncio.to_thread 包装）。

    cancel_event: 外部可 set() 来请求取消；本函数会 terminate 子进程并退出循环。
    proc_holder: 若传一个 list，函数会把 Popen 引用放进去，便于外部做更细的控制。
    project_root: docker 模式必传（要 mount 进容器）
    job_id: docker 模式传（用于容器名 + 日志关联）
    """
    if USE_DOCKER_RUNNER:
        if project_root is None:
            raise ValueError("USE_DOCKER_RUNNER=true 需要 project_root 参数")
        cmd, _mount_path, _host_prefix = _build_docker_run_cmd(args, project_root, job_id)
        cwd = None  # docker run 不需要 host cwd
        env = None  # 走 _build_docker_run_cmd 里的 -e
        container_name = (
            f"ppt-job-{job_id}" if job_id
            else cmd[cmd.index("--name") + 1]
        )
    else:
        cmd = ["claude", *args]
        cwd = str(PPTMASTER)
        env = os.environ.copy()
        container_name = None

    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        bufsize=1,
    )
    if proc_holder is not None:
        proc_holder.append(proc)

    # Docker 模式起 watchdog：超时后 cancel + docker stop
    watchdog: threading.Timer | None = None
    if USE_DOCKER_RUNNER and cancel_event is not None:
        watchdog = _start_docker_watchdog(
            cancel_event, DOCKER_RUNNER_TIMEOUT_S, container_name,
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


# ── 同步高层包装 ────────────────────────────────────────────────────

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
) -> dict:
    """组装 args → 调 stream_claude → 判 paused/done → 返回结果 dict。

    返回的 dict 含：status (done|paused|failed|cancelled), session_id, project_dir,
    pptx_path, cost_usd, last_agent_text。

    `require_confirm`：
      True  → stage 3 end_turn 时切 paused（弹 UI 确认面板）
      False → 自动 --resume + 喂 AUTO_CONFIRM_TEXT 继续（除非 env SKIP_EIGHT_CONFIRM 关掉）
              全局 env `SKIP_EIGHT_CONFIRM=true` 仍然可以强制覆盖 → 永远自动 resume。
    """
    # docker 模式：prompt 里要替换 host 路径为容器内路径
    build_kwargs: dict = {}
    if USE_DOCKER_RUNNER:
        user_dir = project_root.resolve().parent.parent
        build_kwargs["mount_path"] = "/work"
        build_kwargs["host_prefix"] = str(user_dir)
    full_prompt = build_initial_prompt(
        prompt, project_name, project_root,
        upload_paths=upload_paths,
        **build_kwargs,
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


# ── async 入口（FastAPI server 用）───────────────────────────────────
# 全局并发 semaphore + 事件 fanout（DB 写 + 推到所有订阅者 Queue）。

MAX_CONCURRENT_JOBS: int = int(os.getenv("MAX_CONCURRENT_JOBS", "3"))
# ── Activity watchdog ────────────────────────────────────
# 跑 claude 可能因为 API 卡住 / 网络问题 hang 几个小时（实测过 3+ 小时）。
# watchdog 每 WATCHDOG_INTERVAL_S 秒扫一次 running job，
# 如果 updated_at 距今 > WATCHDOG_STALE_SECS 秒没动 → 判定卡死：
#   - kill server 内存里持有的 claude 进程（_active_proc_holders）
#   - pgrep 找孤儿 claude 进程（server reload 后内存丢的情况）也 kill
#   - DB 改 failed + refund 1 credit + notify dispatcher 释放槽位
WATCHDOG_STALE_SECS: int = int(os.getenv("WATCHDOG_STALE_SECS", "600"))    # 10 分钟没新 event
WATCHDOG_INTERVAL_S: int = int(os.getenv("WATCHDOG_INTERVAL_S", "60"))     # 检查频率
_watchdog_task: asyncio.Task | None = None
# 并发由 dispatcher 统一调度（active_count() < MAX 时才拉起新 job）；
# 不再需要 asyncio.Semaphore 等待。_active_job_ids 即并发真值。
_active_job_ids: set[str] = set()
_active_proc_holders: dict[str, list] = {}  # 放当前 Popen，供 cancel 用
_active_cancel_events: dict[str, threading.Event] = {}
_subscribers: dict[str, list[asyncio.Queue]] = {}
_seq_counters: dict[str, int] = {}
_seq_locks: dict[str, threading.Lock] = {}

# ── 真正队列化（dispatcher）────────────────────────────────────
# HTTP 层不再 asyncio.create_task(run_job(...))；改成：
#   1. Job 行 status=queued 入库
#   2. notify_dispatcher() 唤醒后台循环
#   3. 后台循环扫 queued jobs（FIFO），有 active_count() < MAX_CONCURRENT_JOBS
#      时把下一个拉起来跑
# 这样 HTTP 永远 201 + status=queued；capacity 满了就在 DB 排队等，跨重启可恢复。
_dispatcher_task: asyncio.Task | None = None
_dispatcher_event: asyncio.Event | None = None  # 懒初始化（asyncio.Event 必须在 event loop 里建）
# resume 确认文本存 DB 的 Job.pending_confirm（v4 schema）。不在内存：server crash
# 也能恢复，dispatcher 重启后仍能正确路由到 resume_job。
# dispatcher 用 (status='queued' AND pending_confirm IS NOT NULL) 识别 resume job。


def init_runtime() -> None:
    """在 event loop 里调用一次：建表 + 建 asyncio.Event。

    注意：不要把"清理上次残留 job"放这里——run_job 热路径会再调一次，会把刚
    启动的 job 立刻标 failed。清理逻辑拆到 cleanup_stuck_jobs()，lifespan 单次调。
    """
    global _dispatcher_event
    init_db()
    if _dispatcher_event is None:
        _dispatcher_event = asyncio.Event()


def cleanup_stuck_jobs() -> int:
    """启动时清理上次没跑完的 job。

    - status=running：server 挂了肯定没在跑，标 failed
    - status=queued：保留！dispatcher 重启后会捞起来跑（这是真正队列化的好处）

    返回清理掉的 running 数量。
    """
    with SessionLocal() as s:
        running = s.query(DbJob).filter(DbJob.status == "running").all()
        for j in running:
            j.status = "failed"
            j.error_message = "server restart interrupted your previous run"
        s.commit()
        return len(running)


# ── Activity watchdog ────────────────────────────────────
# 跑 claude 可能因为 API 卡住 / 网络问题 hang 几个小时（实测过 3+ 小时）。
# watchdog 每 WATCHDOG_INTERVAL_S 秒扫一次 running job，
# 如果 updated_at 距今 > WATCHDOG_STALE_SECS 秒没动 → 判定卡死：
#   - kill server 内存里持有的 claude 进程（_active_proc_holders）
#   - pgrep 找孤儿 claude 进程（server reload 后内存丢的情况）也 kill
#   - DB 改 failed + refund 1 credit + notify dispatcher 释放槽位


def _kill_tracked_proc(job_id: str) -> bool:
    """kill _active_proc_holders 里 server 自己持有的 claude 进程。返回是否 kill 成功。"""
    holder = _active_proc_holders.get(job_id)
    if not holder:
        return False
    proc = holder[0] if holder else None
    if not proc:
        return False
    try:
        if proc.poll() is None:
            proc.kill()
            log.warning("watchdog: killed tracked claude pid=%s for job %s", proc.pid, job_id)
            return True
    except Exception as e:
        log.warning("watchdog: kill tracked proc failed for %s: %s", job_id, e)
    return False


def _kill_orphan_claude(project_dir_str: str) -> list[int]:
    """pgrep 按 project_dir 路径找孤儿 claude 进程并 kill。

    适用：server reload 后 _active_proc_holders 丢了，但 OS 里 claude 还在跑。
    claude cmdline 包含 `--dir <project_root>`，用 `pgrep -f` 匹配。
    """
    killed = []
    try:
        r = subprocess.run(
            ["pgrep", "-f", f"--dir.*{re.escape(project_dir_str)}"],
            capture_output=True, text=True, timeout=5,
        )
        for pid_s in r.stdout.split():
            try:
                pid = int(pid_s)
                os.kill(pid, 9)
                killed.append(pid)
                log.warning("watchdog: killed orphan claude pid=%s (matched project_dir)", pid)
            except (ProcessLookupError, ValueError):
                pass
    except Exception as e:
        log.warning("watchdog: pgrep failed: %s", e)
    return killed


def _sweep_stale_jobs() -> int:
    """扫描 stale running jobs → kill + mark failed + refund + 通知 dispatcher。

    返回处理数量。
    """
    # DB updated_at 用 server_default=func.now()（SQLite 上是 CURRENT_TIMESTAMP = UTC 字符串）。
    # 用 SQL 直接做时间比较，避免 Python 端 naive vs aware 时区混淆：
    #   - SQLite:  `datetime('now', '-600 seconds')`     → UTC 字符串
    #   - MySQL:   `DATE_SUB(UTC_TIMESTAMP(), INTERVAL 600 SECOND)`
    # 两个 DB 的 `updated_at` 列定义都是 naive（无时区），所以字符串/原生 dt 比较即可。
    stale_ids: list[str] = []
    threshold_seconds = WATCHDOG_STALE_SECS

    with SessionLocal() as s:
        if _is_sqlite():
            cutoff_expr = literal_column(f"datetime('now', '-{threshold_seconds} seconds')")
        else:
            # MySQL / Postgres
            cutoff_expr = literal_column(
                f"DATE_SUB(UTC_TIMESTAMP(), INTERVAL {threshold_seconds} SECOND)"
            )
        stale = (
            s.query(DbJob)
            .filter(DbJob.status == "running", DbJob.updated_at < cutoff_expr)
            .all()
        )
        for j in stale:
            stale_ids.append(j.id)
            killed_count = 0
            # 1. kill server 自己持有的 proc
            if _kill_tracked_proc(j.id):
                killed_count += 1
            # 2. 找孤儿（reload 后内存丢的情况）
            if j.user_id:
                try:
                    project_dir = str(project_root_for(j.user_id, j.id))
                    killed_count += len(_kill_orphan_claude(project_dir))
                except Exception as e:
                    log.warning("watchdog: project_dir lookup failed for %s: %s", j.id, e)
            # 3. 改 status + refund（server / API 问题，不该用户承担）
            j.status = "failed"
            j.error_message = (
                f"watchdog: no event for {WATCHDOG_STALE_SECS}s; "
                f"killed {killed_count} claude process(es)"
            )
            if j.user_id:
                u = s.get(User, j.user_id)
                if u:
                    u.quota_credits += 1
                    log.info("watchdog: refund 1 credit to user %s (job %s)",
                             j.user_id, j.id)
        if stale:
            s.commit()

    # 4. 清 server 内部状态 + 通知 dispatcher（让下一个 queued job 顶上）
    for jid in stale_ids:
        _active_job_ids.discard(jid)
        _active_proc_holders.pop(jid, None)
        _active_cancel_events.pop(jid, None)
        _enqueue_event(jid, "status", {"status": "failed"})

    if stale_ids:
        notify_dispatcher()
        log.warning(
            "watchdog: cleaned %d stale job(s) (threshold=%ds): %s",
            len(stale_ids), WATCHDOG_STALE_SECS, stale_ids,
        )
    return len(stale_ids)


async def _watchdog_loop() -> None:
    """每 WATCHDOG_INTERVAL_S 秒跑一次 _sweep_stale_jobs。"""
    log.info("watchdog loop running (interval=%ds, stale=%ds)",
             WATCHDOG_INTERVAL_S, WATCHDOG_STALE_SECS)
    while True:
        try:
            # 先 sleep 再扫，避免启动瞬间就触发
            await asyncio.sleep(WATCHDOG_INTERVAL_S)
            _sweep_stale_jobs()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("watchdog error: %s", e)


def start_watchdog() -> None:
    """lifespan 启动时调：拉起 watchdog 后台循环。幂等。"""
    global _watchdog_task
    if _watchdog_task is not None and not _watchdog_task.done():
        return
    _watchdog_task = asyncio.create_task(_watchdog_loop())
    log.info("watchdog started (stale=%ds, interval=%ds)",
             WATCHDOG_STALE_SECS, WATCHDOG_INTERVAL_S)


async def stop_watchdog() -> None:
    """lifespan 关闭时调：取消 watchdog 循环。"""
    global _watchdog_task
    if _watchdog_task is None:
        return
    if not _watchdog_task.done():
        _watchdog_task.cancel()
        try:
            await _watchdog_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.warning("watchdog stop: %s", e)
    _watchdog_task = None
    log.info("watchdog stopped")


def start_dispatcher() -> None:
    """lifespan 启动时调一次：拉起 dispatcher 后台循环。

    幂等：重复调不会起多个 loop（看 _dispatcher_task 是否还在）。
    """
    global _dispatcher_task
    init_runtime()  # 确保 _dispatcher_event 已建
    if _dispatcher_task is not None and not _dispatcher_task.done():
        return
    _dispatcher_task = asyncio.create_task(_dispatcher_loop())
    log.info("dispatcher started (MAX_CONCURRENT_JOBS=%d)", MAX_CONCURRENT_JOBS)


async def stop_dispatcher() -> None:
    """lifespan 关闭时调：取消 dispatcher 循环。"""
    global _dispatcher_task
    if _dispatcher_task is None:
        return
    if not _dispatcher_task.done():
        _dispatcher_task.cancel()
        try:
            await _dispatcher_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.warning("dispatcher stop: %s", e)
    _dispatcher_task = None
    log.info("dispatcher stopped")


def notify_dispatcher() -> None:
    """唤醒 dispatcher。

    调用时机：
      - create_job 落库后（立刻拉下一个）
      - run_job / resume_job 跑完释放槽位后（让下一个顶上）
      - 取消 job 后（虽然不直接减少 active_count，但触发一次重扫避免过期）
    """
    if _dispatcher_event is not None:
        _dispatcher_event.set()


def queue_resume(job_id: str, confirm: str) -> None:
    """resume endpoint 调：把 confirm 写进 Job.pending_confirm + notify。

    dispatcher 看到 pending_confirm IS NOT NULL 时调 resume_job，否则调 run_job。
    """
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if j:
            j.pending_confirm = confirm
            s.commit()
    notify_dispatcher()


async def _dispatcher_loop() -> None:
    """dispatcher 主循环：有空位 + 有 queued job → 拉起下一个。

    唤醒源：
      - notify_dispatcher() 立刻触发
      - 内部 wait_for(event, 2s) 兜底（应对漏 signal / 跨重启场景）
    """
    assert _dispatcher_event is not None
    log.info("dispatcher loop running")
    while True:
        try:
            await _dispatch_one()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("dispatcher error: %s", e)
        # 等下一次唤醒；2s 兜底
        try:
            await asyncio.wait_for(_dispatcher_event.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass
        _dispatcher_event.clear()


async def _dispatch_one() -> None:
    """有空位就从队列里拉一个 job 启动。

    优先级：
      1. resume job（pending_confirm IS NOT NULL）—— 用户已确认，优先顶上避免长时间等待
      2. 否则 FIFO（按 created_at 升序）

    SQLite 没 NULLS LAST：用 `(pending_confirm IS NULL)` —— False (=NOT NULL) 排在前。
    """
    if active_count() >= MAX_CONCURRENT_JOBS:
        return
    with SessionLocal() as s:
        # 优先 resume（pending_confirm 非空），再按 FIFO（同 created_at 用 id 排，保证稳定）。
        # SQLAlchemy 里 (pending_confirm.is_(None)) 编译成 SQLite/MySQL 通用的 IS NULL 表达式，
        # 取反后 pending_confirm 非空 = False 排在前面。
        j = (
            s.query(DbJob)
            .filter(DbJob.status == "queued")
            .order_by(
                DbJob.pending_confirm.is_(None).asc(),
                DbJob.created_at.asc(),
                DbJob.id.asc(),
            )
            .first()
        )
        if not j:
            return
        # 二次确认（防 cancel 抢先、或并发 modify）
        fresh = s.get(DbJob, j.id)
        if not fresh or fresh.status != "queued":
            return
        job_id = fresh.id
        user_id = fresh.user_id
        prompt = fresh.prompt
        project_name = fresh.project_name
        confirm = fresh.pending_confirm  # None 表示新 run；非 None 是 resume
        # 取出后立刻清掉 pending_confirm——避免 dispatch 失败时无限重试同一个 confirm
        if confirm is not None:
            fresh.pending_confirm = None
            s.commit()

    upload_paths = _collect_upload_paths(user_id, job_id)

    if confirm is not None:
        log.info("dispatcher: resume job %s (queue_len=%d, active=%d)",
                 job_id, queue_count(), active_count())
        asyncio.create_task(resume_job(job_id, confirm))
    else:
        log.info("dispatcher: start job %s (queue_len=%d, active=%d)",
                 job_id, queue_count(), active_count())
        asyncio.create_task(run_job(job_id, prompt, project_name, upload_paths=upload_paths))


def queue_count() -> int:
    """当前 queued 状态的 job 数量（DB 视角）。"""
    with SessionLocal() as s:
        return s.query(DbJob).filter(DbJob.status == "queued").count()


def queue_position(job_id: str) -> int | None:
    """返回 job 在队列中的位置（1-indexed）；不在 queued 返回 None。

    给前端做「您前面还有 N 位」提示用。

    按 dispatcher 同样的优先级排序（pending_confirm 非空优先 + FIFO），
    找到 job_id 在排序列表里的 index。SQLite 的 DateTime 存为秒精度字符串，
    用 `<` 比较 datetime 对象有微秒差异问题；用 list 索引更稳。
    """
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if not j or j.status != "queued":
            return None
        all_queued = (
            s.query(DbJob.id)
            .filter(DbJob.status == "queued")
            .order_by(
                DbJob.pending_confirm.is_(None).asc(),
                DbJob.created_at.asc(),
                DbJob.id.asc(),  # 同 created_at 时按 id 排，保证稳定
            )
            .all()
        )
        for idx, (qid,) in enumerate(all_queued):
            if qid == job_id:
                return idx + 1
        return None  # 理论上不会到这（j 是 queued）


def _next_seq(job_id: str) -> int:
    """线程安全的 seq 自增（worker 线程 + async 路径都会调）。"""
    lock = _seq_locks.setdefault(job_id, threading.Lock())
    with lock:
        _seq_counters[job_id] = _seq_counters.get(job_id, 0) + 1
        return _seq_counters[job_id]


def _enqueue_event(job_id: str, type_: str, payload: dict) -> dict:
    """写 DB + fanout 到所有订阅者 Queue。返回含 seq/type/payload 的 event dict。"""
    seq = _next_seq(job_id)
    payload_json = json.dumps(payload, ensure_ascii=False)

    # 写 DB
    with SessionLocal() as s:
        s.add(DbEvent(job_id=job_id, seq=seq, type=type_, payload=payload_json))
        j = s.get(DbJob, job_id)
        if j:
            j.last_event_seq = max(j.last_event_seq, seq)
            if type_ == "agent_text" and payload.get("text"):
                # 仅在没有 last_agent_text 或新内容更长时覆盖（避免每 token 都覆盖）
                new_text = payload["text"]
                if not j.last_agent_text or len(new_text) >= len(j.last_agent_text or ""):
                    j.last_agent_text = new_text
            elif type_ == "status" and payload.get("status"):
                # 镜像 status 到 job 表（runner 也会写终态，这里负责 running/paused 中间态）
                new_status = payload["status"]
                if new_status in ("running", "paused") and j.status in ("queued", "running", "paused"):
                    j.status = new_status
        s.commit()

    event = {"seq": seq, "type": type_, "payload": payload}
    # fanout（非阻塞，丢早事件：DB 是 source of truth）
    for q in list(_subscribers.get(job_id, [])):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass
    return event


def subscribe(job_id: str) -> asyncio.Queue:
    """SSE handler 订阅本 job 的事件流。返回 queue（最大 1000 条）。"""
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    _subscribers.setdefault(job_id, []).append(q)
    return q


def unsubscribe(job_id: str, q: asyncio.Queue) -> None:
    if job_id in _subscribers and q in _subscribers[job_id]:
        _subscribers[job_id].remove(q)
        if not _subscribers[job_id]:
            del _subscribers[job_id]


def active_count() -> int:
    return len(_active_job_ids)


def active_job_ids() -> list[str]:
    return sorted(_active_job_ids)


def has_capacity() -> bool:
    """是否还有空槽（dispatcher 拿这个决定能否拉起下一个）。"""
    return active_count() < MAX_CONCURRENT_JOBS


def is_active(job_id: str | None = None) -> bool:
    if job_id is not None:
        return job_id in _active_job_ids
    return bool(_active_job_ids)


def get_active_job_id() -> str | None:
    # 向后兼容：老调用只关心单 active，返回任意一个
    return next(iter(_active_job_ids), None)


def _event_to_db_payload(ev: dict) -> tuple[str, dict] | None:
    """把 on_event 的 dict 翻译成 (type, payload) 写到 DB。"""
    k = ev.get("kind")
    if k == "status":
        return ("status", {"status": ev.get("status")})
    if k == "stage":
        return ("stage", {"stage": ev.get("stage")})
    if k == "tool":
        return ("tool", {
            "tool": ev.get("tool"),
            "command": ev.get("command"),
            "file_path": ev.get("file_path"),
            "stage": ev.get("stage"),
        })
    if k == "agent_text":
        return ("agent_text", {"text": ev.get("text", "")})
    if k == "result":
        r = ev.get("result", {})
        return ("result", {
            "session_id": r.get("session_id"),
            "cost_usd": r.get("total_cost_usd"),
            "stop_reason": r.get("stop_reason"),
        })
    if k == "spec":
        return ("spec", {
            "design_spec": ev.get("design_spec"),
            "spec_lock": ev.get("spec_lock"),
        })
    if k == "error":
        return ("error", {"message": ev.get("message", "")})
    return None


async def run_job(job_id: str, prompt: str, project_name: str, upload_paths: list[str] | None = None) -> None:
    """后台任务入口：跑一次 ppt-master 生成。

    由 dispatcher 拉起（dispatcher 已经确保 active_count() < MAX_CONCURRENT_JOBS），
    本函数不再 acquire semaphore / 不再排队——信任 dispatcher。

    Phase 2 行为：
      - 从 Job 行读 user_id（run_job 不接受 user_id 参数；HTTP 层已设进 DB）
      - 算 per-user project_root = data/users/<uid>/projects/<job_id>/
      - mkdir -p project_root
      - 把 upload_paths（绝对路径列表）塞进 prompt，让 agent 跑 import-sources --copy
      - 改 status=running（带二次确认防 cancel 抢先）
      - 启动 worker 线程跑 run_sync
      - 完成后写 job 表 + fanout + 通知 dispatcher（让队列下一个顶上）
      - 任何异常 finally 标 failed 并清状态
    """
    init_runtime()

    # 读 Job 拿 user_id → 算 project_root
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if not j:
            _enqueue_event(job_id, "error", {"message": f"job {job_id} not found"})
            return
        user_id = j.user_id
        if not user_id:
            _enqueue_event(job_id, "error", {"message": "job has no user_id (legacy?)"})
            return
        project_root = project_root_for(user_id, job_id)

    project_root.mkdir(parents=True, exist_ok=True)

    # 二次确认：dispatcher 选出来到真的开跑中间可能被用户取消
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if not j or j.status == "cancelled":
            return
        if j.status not in ("queued", "running"):
            return
        j.status = "running"
        s.commit()

    _active_job_ids.add(job_id)
    _active_proc_holders[job_id] = []
    _active_cancel_events[job_id] = threading.Event()
    _enqueue_event(job_id, "status", {"status": "running"})

    def on_event(ev: dict) -> None:
        # 同步回调，跑在 worker 线程里。事件入 DB + fanout。
        t = _event_to_db_payload(ev)
        if t is None:
            return
        type_, payload = t
        _enqueue_event(job_id, type_, payload)

    try:
        # 在线程池跑 run_sync
        final = await asyncio.to_thread(
            run_sync, prompt, project_name, project_root, on_event,
            upload_paths=upload_paths,
            cancel_event=_active_cancel_events[job_id],
            proc_holder=_active_proc_holders[job_id],
            require_confirm=False,  # 八点确认已禁用，永远不要求确认
            job_id=job_id,
        )
        # 写 job 表
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                j.status = final["status"]
                j.session_id = final["session_id"]
                j.project_dir = final["project_dir"]
                j.pptx_path = final["pptx_path"]
                j.cost_usd = final["cost_usd"]
                j.error_message = final.get("error_message")
                # 进展检测 bail：refund credit（agent 撒谎 / 空转不是用户的问题）
                if final.get("refund") and j.user_id:
                    u = s.get(User, j.user_id)
                    if u:
                        u.quota_credits += 1
                        log.info("refund 1 credit to user %s (auto-resume bail for job %s)",
                                 j.user_id, job_id)
                s.commit()
        if final.get("pptx_path"):
            _enqueue_event(job_id, "pptx", {"url": f"/api/jobs/{job_id}/pptx"})
    except Exception as e:
        logging.exception("run_job failed")
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                j.status = "failed"
                j.error_message = f"runner exception: {e}"
                s.commit()
            # runner 异常 refund 1 credit（pre-decrement 的对冲）。
            # 正常 run_sync 返回的 status="failed"（claude 跑完但没出 pptx）不 refund。
            if j and j.user_id:
                u = s.get(User, j.user_id)
                if u:
                    u.quota_credits += 1
        _enqueue_event(job_id, "error", {"message": f"runner exception: {e}"})
    finally:
        _active_job_ids.discard(job_id)
        _active_proc_holders.pop(job_id, None)
        _active_cancel_events.pop(job_id, None)
        # 槽位释放：唤醒 dispatcher 让下一个 queued job 顶上
        notify_dispatcher()


def _collect_upload_paths(user_id: str | None, job_id: str) -> list[str]:
    """dispatcher 拉起 run_job 时重新扫 staging 目录得到 upload_paths。

    create_job 阶段已经把文件写到 data/users/<uid>/uploads/<job_id>/，但
    upload_paths 没落库——dispatcher 不在 HTTP 请求上下文里，所以从磁盘重扫。
    """
    if not user_id:
        return []
    d = uploads_dir_for(user_id, job_id)
    if not d.exists():
        return []
    return sorted(str(p.resolve()) for p in d.iterdir() if p.is_file())


async def resume_job(job_id: str, confirm: str) -> None:
    """后台任务入口：注入确认继续 `--resume <session_id>`。

    由 dispatcher 拉起（dispatcher 已经确保有空位），不再 acquire semaphore。
    接受 job.status in ('paused', 'queued')：dispatcher 路径里 endpoint 已经把
    status 改成 queued；直接调路径里 status 还是 paused。
    """
    init_runtime()

    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if not j:
            _enqueue_event(job_id, "error", {"message": f"job {job_id} not found"})
            return
        if j.status not in ("paused", "queued"):
            _enqueue_event(job_id, "error", {"message": f"job status is {j.status}, cannot resume"})
            return
        if not j.session_id:
            _enqueue_event(job_id, "error", {"message": "no session_id to resume"})
            return
        if not j.user_id:
            _enqueue_event(job_id, "error", {"message": "job has no user_id"})
            return
        session_id = j.session_id
        project_name = j.project_name
        project_root = project_root_for(j.user_id, job_id)
        j.status = "running"
        s.commit()

    _active_job_ids.add(job_id)
    _active_proc_holders[job_id] = []
    _active_cancel_events[job_id] = threading.Event()

    def on_event(ev: dict) -> None:
        t = _event_to_db_payload(ev)
        if t is None:
            return
        type_, payload = t
        _enqueue_event(job_id, type_, payload)

    try:
        final = await asyncio.to_thread(
            resume_sync, session_id, confirm, project_root, project_name, on_event,
            cancel_event=_active_cancel_events[job_id],
            proc_holder=_active_proc_holders[job_id],
            job_id=job_id,
        )
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                # cost 累加
                prev_cost = j.cost_usd or 0
                j.status = final["status"]
                j.session_id = final["session_id"] or session_id
                j.project_dir = final["project_dir"] or j.project_dir
                j.pptx_path = final["pptx_path"] or j.pptx_path
                j.cost_usd = prev_cost + (final["cost_usd"] or 0)
                j.error_message = final.get("error_message")
                s.commit()
        if final.get("pptx_path"):
            _enqueue_event(job_id, "pptx", {"url": f"/api/jobs/{job_id}/pptx"})
    except Exception as e:
        logging.exception("resume_job failed")
        with SessionLocal() as s:
            j = s.get(DbJob, job_id)
            if j:
                j.status = "failed"
                j.error_message = f"resume exception: {e}"
                s.commit()
        _enqueue_event(job_id, "error", {"message": f"resume exception: {e}"})
    finally:
        _active_job_ids.discard(job_id)
        _active_proc_holders.pop(job_id, None)
        _active_cancel_events.pop(job_id, None)
        # 槽位释放：唤醒 dispatcher 让下一个顶上
        notify_dispatcher()


def cancel_active(job_id: str) -> bool:
    """请求取消指定 active job。返回是否成功发起取消。"""
    cancel_event = _active_cancel_events.get(job_id)
    proc_holder = _active_proc_holders.get(job_id) or []
    if cancel_event is None or not proc_holder:
        return False
    cancel_event.set()
    proc = proc_holder[0] if proc_holder else None
    if proc and proc.poll() is None:
        try:
            proc.terminate()
        except Exception:
            pass
    # 标 cancelled（cancel 是异步的，标了之后还会推进一轮 cleanup）
    with SessionLocal() as s:
        j = s.get(DbJob, job_id)
        if j and j.status in ("queued", "running"):
            j.status = "cancelled"
            j.error_message = "user cancelled"
            s.commit()
    _enqueue_event(job_id, "status", {"status": "cancelled"})
    return True
