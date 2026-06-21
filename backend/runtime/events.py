"""SSE event persistence and fanout."""
from __future__ import annotations

import asyncio
import json
import logging
import threading

from backend.db.session import SessionLocal
from backend.models import Event as DbEvent
from backend.models import Job as DbJob
from backend.runtime import state

log = logging.getLogger("backend.runtime.events")


def _next_seq(job_id: str) -> int:
    lock = state._seq_locks.setdefault(job_id, threading.Lock())
    with lock:
        state._seq_counters[job_id] = state._seq_counters.get(job_id, 0) + 1
        return state._seq_counters[job_id]


def _enqueue_event(job_id: str, type_: str, payload: dict) -> dict:
    seq = _next_seq(job_id)
    payload_json = json.dumps(payload, ensure_ascii=False)

    with SessionLocal() as s:
        s.add(DbEvent(job_id=job_id, seq=seq, type=type_, payload=payload_json))
        j = s.get(DbJob, job_id)
        if j:
            j.last_event_seq = max(j.last_event_seq, seq)
            if type_ == "agent_text" and payload.get("text"):
                new_text = payload["text"]
                if not j.last_agent_text or len(new_text) >= len(j.last_agent_text or ""):
                    j.last_agent_text = new_text
            elif type_ == "status" and payload.get("status"):
                new_status = payload["status"]
                if new_status in ("running", "paused") and j.status in ("queued", "running", "paused"):
                    j.status = new_status
        s.commit()

    event = {"seq": seq, "type": type_, "payload": payload}
    for q in list(state._subscribers.get(job_id, [])):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass
    return event


def subscribe(job_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    state._subscribers.setdefault(job_id, []).append(q)
    return q


def unsubscribe(job_id: str, q: asyncio.Queue) -> None:
    if job_id in state._subscribers and q in state._subscribers[job_id]:
        state._subscribers[job_id].remove(q)
        if not state._subscribers[job_id]:
            del state._subscribers[job_id]


def _event_to_db_payload(ev: dict) -> tuple[str, dict] | None:
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
