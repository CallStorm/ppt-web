"""SQLAlchemy 引擎 + 会话工厂。

DB 选型：默认 SQLite（本地开发零依赖）；通过 DB_URL 环境变量切 MySQL：
    DB_URL=mysql+pymysql://user:pwd@host:3306/db?charset=utf8mb4

SQLite 专属：
  - PRAGMA WAL / synchronous=NORMAL / busy_timeout（高频事件写优化）
  - 迁移时直接删 jobs.db 文件（最稳，in-place 改 FK 风险大）
  - connect_args.check_same_thread=False（让 SQLAlchemy session 跨线程）

MySQL 必备：
  - 库字符集 utf8mb4 / collation utf8mb4_unicode_ci（防中文/emoji 截断）
  - 迁移时 DROP TABLE 重建
  - TINYINT(1) 代替 BOOLEAN（MySQL 的 BOOLEAN 是别名）
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

# DB_URL env 驱动；未设则落回 SQLite 本地文件
DB_URL = os.getenv("DB_URL", f"sqlite:///{DB_PATH}")


def _is_sqlite() -> bool:
    return DB_URL.startswith("sqlite")


# SQLite 专属 connect_args；MySQL 用 PyMySQL 不需要也不接受
_connect_args: dict = {"check_same_thread": False} if _is_sqlite() else {}

engine = create_engine(
    DB_URL,
    connect_args=_connect_args,
    future=True,
    pool_pre_ping=True,  # MySQL 闲置连接可能被 server 关掉，ping 一下重连
)


if _is_sqlite():
    @event.listens_for(engine, "connect")
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


def _has_legacy_v1_schema() -> bool:
    """检测是否需要 v1→v2 迁移：有 v1 表（events/jobs）但没有 users 表。"""
    if _has_users_table():
        return False  # 已经在 v2+
    has_events = inspect(engine).has_table("events")
    has_jobs = inspect(engine).has_table("jobs")
    return has_events or has_jobs


def _drop_legacy_v1_schema() -> None:
    """按 DB 类型分头清理 v1 schema。"""
    if _is_sqlite():
        # SQLite：删文件最稳（in-place DROP+CREATE 风险高）
        log.warning("dropping SQLite jobs.db (and WAL/SHM/journal sidecars)")
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = Path(str(DB_PATH) + suffix)
            if p.exists():
                try:
                    p.unlink()
                except OSError as e:
                    log.error(f"failed to remove {p}: {e}")
    else:
        # MySQL/Postgres：直接 DROP TABLE（依赖级联）
        log.warning("dropping legacy v1 tables (events, jobs) — recreating fresh")
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP TABLE IF EXISTS events")
            conn.exec_driver_sql("DROP TABLE IF EXISTS jobs")


def migrate_v1_to_v2() -> bool:
    """检测旧 schema（v1: 有 events/jobs 但无 users），整库重建。

    返回是否执行了迁移。MVP 阶段无真实数据可保留；新结构 + 新 FK 不能 in-place 改。
    """
    if not _has_legacy_v1_schema():
        return False
    log.warning("migrating DB v1 -> v2 (dropping old data, recreating schema)")
    _drop_legacy_v1_schema()
    return True


def _has_column(table: str, column: str) -> bool:
    try:
        insp = inspect(engine)
        return column in {c["name"] for c in insp.get_columns(table)}
    except Exception:
        return False


def migrate_v2_to_v3() -> bool:
    """v2 → v3: jobs 表加 require_confirm 列（SQLite: BOOLEAN; MySQL: TINYINT(1)）。

    已有 jobs 行保持默认 0（即"不需要确认"——与新默认值一致，老 job 行为不破坏）。
    返回是否执行了迁移。
    """
    if not _has_users_table():
        return False  # v1 还没迁完，init_db 会全量建表
    if not inspect(engine).has_table("jobs"):
        return False
    if _has_column("jobs", "require_confirm"):
        return False
    # 同一 ALTER 语法两个 DB 都接受：BOOLEAN 在 MySQL 是 TINYINT(1) 别名
    log.warning("migrating DB v2 -> v3 (adding jobs.require_confirm)")
    with engine.begin() as conn:
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
