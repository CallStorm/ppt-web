#!/usr/bin/env python3
"""Smoke test — run job without HTTP."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import uuid
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from backend.auth import hash_password
from backend.db.migrations import migrate_v1_to_v2
from backend.db.session import SessionLocal, init_db
from backend.models import Event, Job, User
from backend.runtime import cancel_active, init_runtime, run_job


async def watch_events(job_id: str, stop_at: float) -> None:
    last_seq = 0
    while time.time() < stop_at:
        await asyncio.sleep(1.0)
        with SessionLocal() as s:
            rows = (
                s.query(Event)
                .filter(Event.job_id == job_id, Event.seq > last_seq)
                .order_by(Event.seq)
                .all()
            )
            for r in rows:
                if r.type == "tool":
                    p = json.loads(r.payload)
                    print(
                        f"  [{r.seq:3d}] tool    {p.get('stage') or p.get('tool')}: "
                        f"{(p.get('command') or p.get('file_path') or '')[:80]}"
                    )
                elif r.type in ("status", "result", "pptx"):
                    print(f"  [{r.seq:3d}] {r.type:9s} {r.payload[:120]}")
                elif r.type == "error":
                    print(f"  [{r.seq:3d}] ERROR   {r.payload[:200]}")
                last_seq = r.seq


async def main_async(prompt: str, auto_cancel_after: float | None) -> int:
    if migrate_v1_to_v2():
        print("migrated jobs.db v1 -> v2 (data dropped)")
    init_runtime()
    init_db()

    job_id = str(uuid.uuid4())
    project_name = f"smoke_{job_id[:8]}"

    with SessionLocal() as s:
        smoke_email = "smoke@local"
        u = s.query(User).filter(User.email == smoke_email).first()
        if not u:
            u = User(
                id=str(uuid.uuid4()),
                email=smoke_email,
                password_hash=hash_password("smoke-password"),
            )
            s.add(u)
            s.commit()
            s.refresh(u)
        s.add(
            Job(
                id=job_id,
                user_id=u.id,
                prompt=prompt,
                project_name=project_name,
                status="queued",
            )
        )
        s.commit()

    print(f"job {job_id}  project={project_name}  user={u.id[:8]}")

    runner = asyncio.create_task(run_job(job_id, prompt, project_name))
    stop_at = time.time() + (auto_cancel_after if auto_cancel_after else 600)
    watcher = asyncio.create_task(watch_events(job_id, stop_at))

    try:
        await asyncio.wait_for(runner, timeout=auto_cancel_after or 600)
    except asyncio.TimeoutError:
        print(f"\n{auto_cancel_after}s elapsed, triggering cancel")
        cancel_active(job_id)
        try:
            await asyncio.wait_for(runner, timeout=10)
        except asyncio.TimeoutError:
            print("runner did not exit in 10s")
            runner.cancel()
            try:
                await runner
            except asyncio.CancelledError:
                pass
        except asyncio.CancelledError:
            pass
        # Give cancel a moment to land in DB before summary.
        for _ in range(20):
            with SessionLocal() as s:
                st = s.get(Job, job_id).status
            if st in ("done", "cancelled", "paused", "failed"):
                break
            await asyncio.sleep(0.5)
    finally:
        watcher.cancel()
        try:
            await watcher
        except asyncio.CancelledError:
            pass

    with SessionLocal() as s:
        j = s.get(Job, job_id)
        events = s.query(Event).filter_by(job_id=job_id).count()
        type_counter = Counter(r.type for r in s.query(Event.type).filter_by(job_id=job_id).all())

    print("\n=== summary ===")
    print(f"  status:    {j.status}")
    print(f"  events:    {events}")
    print(f"  cost_usd:  {j.cost_usd}")
    print(f"  pptx_path: {j.pptx_path}")
    print(f"  session:   {j.session_id}")
    print(f"  types:     {dict(type_counter)}")
    return 0 if j.status in ("done", "cancelled", "paused", "failed") else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt", help="PPT prompt")
    ap.add_argument("--full", action="store_true", help="no auto cancel")
    ap.add_argument("--seconds", type=float, default=30, help="auto-cancel seconds")
    args = ap.parse_args()
    return asyncio.run(
        main_async(args.prompt, auto_cancel_after=None if args.full else args.seconds)
    )


if __name__ == "__main__":
    sys.exit(main())
