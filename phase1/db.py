"""SQLAlchemy 引擎 + 会话工厂。

jobs.db 放在项目根 `ppt-web/jobs.db`（gitignore）。
WAL + synchronous=NORMAL 让高频事件写入不卡 fsync。

Phase 2: 加了 migrate_v1_to_v2() —— 首次启动时检测旧 schema（无 users 表），
打印警告并删除重建（drop in-place 风险太高，删文件最稳）。
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from phase1.models import Base

log = logging.getLogger("phase1.db")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "jobs.db"
DB_URL = f"sqlite:///{DB_PATH}"

# check_same_thread=False 让 SQLAlchemy session 可以在多线程间共享（FastAPI
# 的 worker 线程和 to_thread 里的子进程 reader 都会用到）。
engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False},
    future=True,
)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    """每次新连接启用 WAL + NORMAL 同步 + busy_timeout。"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def _has_users_table() -> bool:
    """SQLAlchemy 1.4+ 用 inspect().has_table()。"""
    try:
        return inspect(engine).has_table("users")
    except Exception:
        return False


def migrate_v1_to_v2() -> bool:
    """检测旧 schema（v1: 无 users 表），删 DB 重建。

    返回是否执行了迁移。MVP 阶段无真实数据可保留；新结构 + 新 FK 不能 in-place 改。
    """
    if not DB_PATH.exists():
        return False
    if _has_users_table():
        return False
    log.warning("migrating jobs.db v1 -> v2 (dropping old data, recreating schema)")
    # 删主库 + WAL/SHM 旁车
    for suffix in ("", "-wal", "-shm", "-journal"):
        p = Path(str(DB_PATH) + suffix)
        if p.exists():
            try:
                p.unlink()
            except OSError as e:
                log.error(f"failed to remove {p}: {e}")
    return True


def _has_column(table: str, column: str) -> bool:
    try:
        insp = inspect(engine)
        return column in {c["name"] for c in insp.get_columns(table)}
    except Exception:
        return False


def migrate_v2_to_v3() -> bool:
    """v2 → v3: jobs 表加 require_confirm BOOLEAN NOT NULL DEFAULT 0。

    已有 jobs 行保持 0（即"不需要确认"——与新默认值一致，老 job 行为不破坏）。
    返回是否执行了迁移。
    """
    if not DB_PATH.exists():
        return False
    if not _has_users_table():
        return False  # v1 还没迁完，init_db 会全量建表
    if _has_column("jobs", "require_confirm"):
        return False
    log.warning("migrating jobs.db v2 -> v3 (adding jobs.require_confirm)")
    with engine.begin() as conn:
        # SQLite 不支持在 ALTER ADD COLUMN 同时加 NOT NULL DEFAULT 非空历史行，
        # 但 DEFAULT 0 走 server_default 的回填逻辑；这里显式写一遍让语义清楚。
        conn.exec_driver_sql(
            "ALTER TABLE jobs ADD COLUMN require_confirm BOOLEAN NOT NULL DEFAULT 0"
        )
    return True


def init_db() -> None:
    """建表（已存在则忽略）。幂等。"""
    Base.metadata.create_all(engine)


def get_session() -> Session:
    """FastAPI 依赖注入用。"""
    return SessionLocal()
