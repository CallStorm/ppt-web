"""SQLAlchemy engine and session factory."""
from __future__ import annotations

import logging
import os
from pathlib import Path

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import Session, sessionmaker

from backend.models import Base

log = logging.getLogger("backend.db")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = PROJECT_ROOT / "jobs.db"
DB_URL = os.getenv("DB_URL", f"sqlite:///{DB_PATH}")


def _is_sqlite() -> bool:
    return DB_URL.startswith("sqlite")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _engine_kwargs() -> dict:
    kwargs: dict = {
        "future": True,
        "pool_pre_ping": True,
    }
    if _is_sqlite():
        kwargs["connect_args"] = {"check_same_thread": False}
        # SQLite: single file — avoid QueuePool contention under burst writes.
        kwargs["poolclass"] = __import__(
            "sqlalchemy.pool", fromlist=["StaticPool"]
        ).StaticPool
    else:
        # MySQL default pool (5 + 10 overflow) is too small for concurrent
        # jobs + SSE + high-frequency event inserts.
        kwargs["pool_size"] = _env_int("DB_POOL_SIZE", 10)
        kwargs["max_overflow"] = _env_int("DB_MAX_OVERFLOW", 20)
        kwargs["pool_timeout"] = _env_int("DB_POOL_TIMEOUT", 60)
        kwargs["pool_recycle"] = _env_int("DB_POOL_RECYCLE", 3600)
    return kwargs


engine = create_engine(DB_URL, **_engine_kwargs())


if _is_sqlite():

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_session() -> Session:
    return SessionLocal()


def pool_status() -> dict[str, int | str]:
    """Best-effort pool stats for logging / admin diagnostics."""
    pool = engine.pool
    backend = pool.__class__.__name__
    if backend == "StaticPool":
        return {"backend": backend}
    try:
        return {
            "backend": backend,
            "size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    except Exception as exc:  # noqa: BLE001
        return {"backend": backend, "error": str(exc)}
