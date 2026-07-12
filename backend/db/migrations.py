"""Database schema migrations."""
from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import inspect

from backend.db.session import DB_PATH, SessionLocal, _is_sqlite, engine, init_db
from backend.models import AppConfig

log = logging.getLogger("backend.db.migrations")


def _has_users_table() -> bool:
    try:
        return inspect(engine).has_table("users")
    except Exception:
        return False


def _has_legacy_v1_schema() -> bool:
    if _has_users_table():
        return False
    has_events = inspect(engine).has_table("events")
    has_jobs = inspect(engine).has_table("jobs")
    return has_events or has_jobs


def _drop_legacy_v1_schema() -> None:
    if _is_sqlite():
        log.warning("dropping SQLite jobs.db (and WAL/SHM/journal sidecars)")
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = Path(str(DB_PATH) + suffix)
            if p.exists():
                try:
                    p.unlink()
                except OSError as e:
                    log.error(f"failed to remove {p}: {e}")
    else:
        log.warning("dropping legacy v1 tables (events, jobs) — recreating fresh")
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP TABLE IF EXISTS events")
            conn.exec_driver_sql("DROP TABLE IF EXISTS jobs")


def migrate_v1_to_v2() -> bool:
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
    if not _has_users_table():
        return False
    if not inspect(engine).has_table("jobs"):
        return False
    if _has_column("jobs", "require_confirm"):
        return False
    log.warning("migrating DB v2 -> v3 (adding jobs.require_confirm)")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "ALTER TABLE jobs ADD COLUMN require_confirm BOOLEAN NOT NULL DEFAULT 0"
        )
    return True


def migrate_v3_to_v4() -> bool:
    if not _has_users_table():
        return False
    if not inspect(engine).has_table("jobs"):
        return False
    if _has_column("jobs", "pending_confirm"):
        return False
    log.warning("migrating DB v3 -> v4 (adding jobs.pending_confirm)")
    with engine.begin() as conn:
        conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN pending_confirm TEXT NULL")
    return True


def migrate_v5_to_v6() -> bool:
    if not _has_users_table():
        return False
    if not inspect(engine).has_table("jobs"):
        return False
    if _has_column("jobs", "options_json"):
        return False
    log.warning("migrating DB v5 -> v6 (adding jobs.options_json)")
    with engine.begin() as conn:
        conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN options_json TEXT NULL")
    return True


def migrate_v4_to_v5() -> bool:
    if not _has_users_table():
        return False
    changed = False
    insp = inspect(engine)
    if not insp.has_table("app_config"):
        log.warning("migrating DB v4 -> v5 (creating app_config + admin_action_logs)")
        changed = True
    init_db()
    with SessionLocal() as s:
        row = s.get(AppConfig, 1)
        if not row:
            s.add(AppConfig(id=1, settings_json="{}", secrets_json="{}", version=1))
            s.commit()
            changed = True
    return changed


def migrate_v6_to_v7() -> bool:
    """Add jobs.revision_of_job_id so a revision job can link back to the
    original deck it was derived from. ON DELETE SET NULL at the model
    layer; SQLite doesn't enforce that, but we don't rely on it — the
    application code never deletes a parent while revisions exist."""
    if not _has_users_table():
        return False
    if not inspect(engine).has_table("jobs"):
        return False
    if _has_column("jobs", "revision_of_job_id"):
        return False
    log.warning("migrating DB v6 -> v7 (adding jobs.revision_of_job_id)")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "ALTER TABLE jobs ADD COLUMN revision_of_job_id VARCHAR(36) NULL"
        )
    # Index for the GET /revisions query: "find all revisions of this job".
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_jobs_revision_of ON jobs (revision_of_job_id)"
            )
    except Exception as e:
        log.warning("could not create ix_jobs_revision_of index: %s", e)
    return True


def migrate_v7_to_v8() -> bool:
    """Create conversations + messages tables for chat-based PPT creation."""
    if not _has_users_table():
        return False
    insp = inspect(engine)
    if insp.has_table("conversations") and insp.has_table("messages"):
        return False
    log.warning("migrating DB v7 -> v8 (creating conversations + messages)")
    init_db()
    return True


def migrate_v8_to_v9() -> bool:
    """Create template_categories + templates tables for beautify template management."""
    if not _has_users_table():
        return False
    insp = inspect(engine)
    if insp.has_table("template_categories") and insp.has_table("templates"):
        return False
    log.warning("migrating DB v8 -> v9 (creating template_categories + templates)")
    init_db()
    return True
