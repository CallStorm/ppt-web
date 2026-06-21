#!/usr/bin/env python3
"""Phase 0 编排器 CLI 壳。

核心逻辑在 `backend.runner`（run_sync / resume_sync / stream_claude / classify_stage）。
本脚本只负责 argparse + 同步消费事件打到终端时间线 —— 与 Phase 1 FastAPI server
共用同一份 core 代码，避免双份维护。

用法：
  python phase0/orchestrator.py run --prompt "..." [--project phase0_demo]
  python phase0/orchestrator.py resume --confirm "..." [--project ...]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# 让 import backend.runner 找到包
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from backend.runner import find_pptx, resolve_project_dir, resume_sync, run_sync  # noqa: E402

STATE_FILE = HERE.parent / ".phase0" / "state.json"


def render_event(ev: dict) -> None:
    """把事件打印成终端时间线（Phase 0 调试用）。"""
    ts = time.strftime("%H:%M:%S")
    k = ev.get("kind")
    if k == "status":
        print(f"{ts} [status] {ev.get('status')}", flush=True)
    elif k == "stage":
        print(f"{ts} [stage]  {ev.get('stage')}", flush=True)
    elif k == "tool":
        stage = ev.get("stage") or ev.get("tool", "")
        detail = (ev.get("command") or ev.get("file_path") or "").strip()
        detail = " ".join(detail.split())[:120]
        print(f"{ts} [{stage}] {detail}", flush=True)
    elif k == "agent_text":
        txt = ev.get("text", "")
        if txt:
            print(f"{ts} [agent]  {txt[:300]}", flush=True)
    elif k == "result":
        r = ev.get("result", {})
        print(f"\n{ts} === result ===", flush=True)
        print(f"  session_id : {r.get('session_id')}", flush=True)
        print(f"  cost_usd   : {r.get('total_cost_usd')}", flush=True)
        print(f"  stop_reason: {r.get('stop_reason')}", flush=True)
    elif k == "error":
        print(f"{ts} [error]  {ev.get('message', '')[:500]}", flush=True)
    elif k == "spec":
        print(f"{ts} [spec]   design_spec={bool(ev.get('design_spec'))} spec_lock={bool(ev.get('spec_lock'))}",
              flush=True)


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def cmd_run(args) -> int:
    project_name = args.project or f"phase0_{int(time.time())}"
    final = run_sync(args.prompt, project_name, on_event=render_event)

    save_state({
        "session_id": final["session_id"],
        "project_name": project_name,
        "project_dir": final["project_dir"],
        "status": final["status"],
        "pptx_path": final["pptx_path"],
        "cost_usd": final["cost_usd"],
        "last_agent_text": final["last_agent_text"],
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    })

    print("\n" + "=" * 60, flush=True)
    if final["status"] == "done":
        print(f"✅ DONE — pptx: {final['pptx_path']}", flush=True)
        return 0
    if final["status"] == "paused":
        print(f"⏸  PAUSED — session: {final['session_id']}", flush=True)
        print(f"   用 `python phase0/orchestrator.py resume --confirm \"你的确认\"` 恢复", flush=True)
        return 10
    print(f"✗ FAILED — {final.get('error_message')}", flush=True)
    return 1


def cmd_resume(args) -> int:
    state = load_state()
    session_id = args.session_id or state.get("session_id")
    if not session_id:
        print("✗ 没有可恢复的会话（state.json 缺失 session_id）", flush=True)
        return 1
    confirm = args.confirm or "确认，按推荐方案继续生成。"
    final = resume_sync(session_id, confirm, on_event=render_event)

    # 更新 state
    state.update({
        "status": final["status"],
        "pptx_path": final["pptx_path"] or state.get("pptx_path"),
        "cost_usd": (state.get("cost_usd") or 0) + (final["cost_usd"] or 0),
        "last_agent_text": final["last_agent_text"],
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    })
    save_state(state)

    print("\n" + "=" * 60, flush=True)
    if final["status"] == "done":
        print(f"✅ DONE — pptx: {final['pptx_path']}", flush=True)
        return 0
    if final["status"] == "paused":
        print(f"⏸  仍 PAUSED — 再次 resume 继续", flush=True)
        return 10
    print(f"✗ FAILED — {final.get('error_message')}", flush=True)
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 0 ppt-master 编排器 CLI 壳")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="启动一次生成")
    r.add_argument("--prompt", required=True, help="用户的文字内容/需求")
    r.add_argument("--project", help="项目目录名（默认自动生成）")
    r.set_defaults(func=cmd_run)

    rs = sub.add_parser("resume", help="恢复一个挂起的会话")
    rs.add_argument("--confirm", help="人类的确认内容（默认按推荐继续）")
    rs.add_argument("--session-id", help="覆盖 state.json 里的 session_id")
    rs.set_defaults(func=cmd_resume)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
