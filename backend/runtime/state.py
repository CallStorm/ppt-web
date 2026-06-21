"""Runtime global mutable state."""
from __future__ import annotations

import asyncio
import threading

_watchdog_task: asyncio.Task | None = None
_active_job_ids: set[str] = set()
_active_proc_holders: dict[str, list] = {}
_active_cancel_events: dict[str, threading.Event] = {}
_subscribers: dict[str, list[asyncio.Queue]] = {}
_seq_counters: dict[str, int] = {}
_seq_locks: dict[str, threading.Lock] = {}
_dispatcher_task: asyncio.Task | None = None
_dispatcher_event: asyncio.Event | None = None
