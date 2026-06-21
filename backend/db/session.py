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


_connect_args: dict = {"check_same_thread": False} if _is_sqlite() else {}

engine = create_engine(
    DB_URL,
    connect_args=_connect_args,
    future=True,
    pool_pre_ping=True,
)


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
