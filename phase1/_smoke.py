#!/usr/bin/env python3
"""Phase 1 烟雾测试 —— 不接 HTTP，直接调 core 跑 job 看事件入 DB + 锁 + cancel 链路。

用法：
  .venv/bin/python phase1/_smoke.py "写一份 4 页 Python 简介 PPT"

行为：
  1. 创建 job（status=queued）
  2. 后台启动 run_job
  3. 持续打印事件（type / 阶段 / 工具）
  4. 默认 30s 后自动 cancel（避免烧 $）；传 --full 不 cancel 跑到底
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from phase1.auth import hash_password
from phase1.core import (
    cancel_active,
    init_runtime,
    is_active,
    resume_job,
    run_job,
)
from phase1.db import SessionLocal, init_db, migrate_v1_to_v2
from phase1.models import Event, Job, User


async def watch_events(job_id: str, stop_at: float) -> None:
    """每 1s 打印新事件统计。"""
    last_seq = 0
    type_counts: dict[str, int] = {}
    while time.time() < stop_at:
        await asyncio.sleep(1.0)
        with SessionLocal() as s:
            rows = s.query(Event).filter(
                Event.job_id == job_id, Event.seq > last_seq
            ).order_by(Event.seq).all()
            for r in rows:
                type_counts[r.type] = type_counts.get(r.type, 0) + 1
                if r.type == "tool":
                    payload = r.payload
                    # 简化打印
                    import json
                    p = json.loads(payload)
                    print(f"  [{r.seq:3d}] tool    {p.get('stage') or p.get('tool')}: "
                          f"{(p.get('command') or p.get('file_path') or '')[:80]}")
                elif r.type in ("status", "result", "pptx"):
                    print(f"  [{r.seq:3d}] {r.type:9s} {r.payload[:120]}")
                elif r.type == "error":
                    print(f"  [{r.seq:3d}] ERROR   {r.payload[:200]}")
                last_seq = r.seq


async def main_async(prompt: str, auto_cancel_after: float | None) -> int:
    if migrate_v1_to_v2():
        print("⚠ migrated jobs.db v1 → v2 (data dropped)")
    init_runtime()
    init_db()  # 二次保险

    job_id = str(uuid.uuid4())
    project_name = f"smoke_{job_id[:8]}"

    # 建一个 smoke 测试用户（Phase 2: Job 必须有 user_id）
    with SessionLocal() as s:
        smoke_email = "smoke@local"
        u = s.query(User).filter(User.email == smoke_email).first()
        if not u:
            u = User(id=str(uuid.uuid4()), email=smoke_email,
                     password_hash=hash_password("smoke-password"))
            s.add(u)
            s.commit()
            s.refresh(u)
        s.add(Job(id=job_id, user_id=u.id, prompt=prompt,
                  project_name=project_name, status="queued"))
        s.commit()

    print(f"▶ job {job_id}  project={project_name}  user={u.id[:8]}")

    # 后台跑 + 前台 watch
    runner = asyncio.create_task(run_job(job_id, prompt, project_name))
    stop_at = time.time() + (auto_cancel_after if auto_cancel_after else 600)
    watcher = asyncio.create_task(watch_events(job_id, stop_at))

    # 等到 runner 完成或到时 cancel
    try:
        await asyncio.wait_for(runner, timeout=auto_cancel_after or 600)
    except asyncio.TimeoutError:
        print(f"\n⏱  {auto_cancel_after}s 到，触发 cancel")
        cancel_active()
        try:
            await asyncio.wait_for(runner, timeout=10)
        except asyncio.TimeoutError:
            print("✗ runner 没在 10s 内退出，强杀")
            runner.cancel()
    finally:
        watcher.cancel()
        try:
            await watcher
        except asyncio.CancelledError:
            pass

    # 汇总
    with SessionLocal() as s:
        j = s.get(Job, job_id)
        events = s.query(Event).filter_by(job_id=job_id).count()
        type_counts_rows = s.query(Event.type, Event.payload).filter_by(job_id=job_id).all()

    from collections import Counter
    type_counter = Counter(r.type for r in type_counts_rows)
    print(f"\n=== 汇总 ===")
    print(f"  status:    {j.status}")
    print(f"  events:    {events}")
    print(f"  cost_usd:  {j.cost_usd}")
    print(f"  pptx_path: {j.pptx_path}")
    print(f"  session:   {j.session_id}")
    print(f"  事件类型分布: {dict(type_counter)}")
    return 0 if j.status in ("done", "cancelled", "paused", "failed") else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt", help="PPT 内容描述")
    ap.add_argument("--full", action="store_true", help="不自动 cancel，跑到底")
    ap.add_argument("--seconds", type=float, default=30, help="auto-cancel 倒计时秒数")
    args = ap.parse_args()
    return asyncio.run(main_async(
        args.prompt,
        auto_cancel_after=None if args.full else args.seconds,
    ))


if __name__ == "__main__":
    sys.exit(main())
