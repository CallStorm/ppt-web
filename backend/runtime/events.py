"""SSE event persistence and fanout."""
from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
import time

from backend.db.session import SessionLocal, pool_status
from backend.models import Event as DbEvent
from backend.models import Job as DbJob
from backend.runtime import state

log = logging.getLogger("backend.runtime.events")

# Serialize DB writes — worker threads fire on_event concurrently during jobs.
_event_db_lock = threading.Lock()

# Background writer: one connection for burst event inserts (agent_text stream).
_event_persist_queue: queue.Queue[tuple | None] | None = None
_event_writer_thread: threading.Thread | None = None

# Throttle agent_text rows in DB (SSE still gets every update).
_AGENT_TEXT_DB_INTERVAL_S = 1.0
_last_agent_text_db_write: dict[str, float] = {}


def _next_seq(job_id: str) -> int:
    lock = state._seq_locks.setdefault(job_id, threading.Lock())
    with lock:
        state._seq_counters[job_id] = state._seq_counters.get(job_id, 0) + 1
        return state._seq_counters[job_id]


def _fanout(job_id: str, event: dict) -> None:
    for q in list(state._subscribers.get(job_id, [])):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


def _persist_event(job_id: str, seq: int, type_: str, payload_json: str) -> None:
    with _event_db_lock:
        with SessionLocal() as s:
            s.add(DbEvent(job_id=job_id, seq=seq, type=type_, payload=payload_json))
            j = s.get(DbJob, job_id)
            if j:
                j.last_event_seq = max(j.last_event_seq, seq)
                if type_ == "agent_text":
                    payload = json.loads(payload_json)
                    new_text = payload.get("text")
                    if new_text and (
                        not j.last_agent_text
                        or len(new_text) >= len(j.last_agent_text or "")
                    ):
                        j.last_agent_text = new_text
                elif type_ == "status":
                    payload = json.loads(payload_json)
                    new_status = payload.get("status")
                    if new_status in ("running", "paused") and j.status in (
                        "queued",
                        "running",
                        "paused",
                    ):
                        j.status = new_status
            s.commit()


def _event_writer_loop() -> None:
    assert _event_persist_queue is not None
    while True:
        item = _event_persist_queue.get()
        try:
            if item is None:
                return
            job_id, seq, type_, payload_json = item
            _persist_event(job_id, seq, type_, payload_json)
        except Exception:
            log.exception(
                "event writer failed job=%s seq=%s type=%s pool=%s",
                item[0] if item else "?",
                item[1] if item else "?",
                item[2] if item else "?",
                pool_status(),
            )
        finally:
            _event_persist_queue.task_done()


def start_event_writer() -> None:
    """Start background DB writer (idempotent). Call from app startup."""
    global _event_persist_queue, _event_writer_thread
    if _event_writer_thread is not None and _event_writer_thread.is_alive():
        return
    _event_persist_queue = queue.Queue(maxsize=10000)
    _event_writer_thread = threading.Thread(
        target=_event_writer_loop,
        name="event-db-writer",
        daemon=True,
    )
    _event_writer_thread.start()
    log.info("event DB writer started")


def _enqueue_event(job_id: str, type_: str, payload: dict) -> dict:
    seq = _next_seq(job_id)
    payload_json = json.dumps(payload, ensure_ascii=False)
    event = {"seq": seq, "type": type_, "payload": payload}

    # SSE subscribers first — UI stays responsive even if DB is slow.
    _fanout(job_id, event)

    skip_db = False
    if type_ == "agent_text":
        now = time.monotonic()
        last = _last_agent_text_db_write.get(job_id, 0.0)
        if now - last < _AGENT_TEXT_DB_INTERVAL_S:
            skip_db = True
        else:
            _last_agent_text_db_write[job_id] = now

    if skip_db:
        return event

    if _event_persist_queue is not None:
        try:
            _event_persist_queue.put_nowait((job_id, seq, type_, payload_json))
            return event
        except queue.Full:
            log.warning(
                "event persist queue full for job %s; falling back to sync write pool=%s",
                job_id,
                pool_status(),
            )

    try:
        _persist_event(job_id, seq, type_, payload_json)
    except Exception:
        log.exception(
            "sync event persist failed job=%s seq=%s pool=%s",
            job_id,
            seq,
            pool_status(),
        )
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
