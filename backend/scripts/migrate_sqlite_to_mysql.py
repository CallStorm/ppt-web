#!/usr/bin/env python3
"""Copy all data from jobs.db (SQLite) into MySQL, overwriting the target."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from backend.db.session import DB_PATH, PROJECT_ROOT  # noqa: E402
from backend.models import AdminActionLog, AppConfig, Base, Event, Job, User  # noqa: E402

TABLE_MODELS = [User, Job, Event, AppConfig, AdminActionLog]
AUTO_INCREMENT_TABLES = ("events", "admin_action_logs")


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip()


def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.resolve()}"


def _drop_mysql_schema(engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        insp = inspect(engine)
        for name in insp.get_table_names():
            conn.execute(text(f"DROP TABLE IF EXISTS `{name}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))


def _copy_table(src: Session, dst: Session, model) -> int:
    rows = src.query(model).all()
    for row in rows:
        dst.merge(model(**{c.key: getattr(row, c.key) for c in model.__table__.columns}))
    dst.commit()
    return len(rows)


def _reset_auto_increment(engine, table: str) -> None:
    with engine.begin() as conn:
        row = conn.execute(text(f"SELECT COALESCE(MAX(id), 0) AS max_id FROM `{table}`")).mappings().one()
        next_id = int(row["max_id"]) + 1
        conn.execute(text(f"ALTER TABLE `{table}` AUTO_INCREMENT = {next_id}"))


def migrate(*, sqlite_path: Path, mysql_url: str, dry_run: bool = False) -> dict[str, int]:
    if not sqlite_path.is_file():
        raise SystemExit(f"SQLite file not found: {sqlite_path}")
    if not mysql_url.startswith("mysql"):
        raise SystemExit(f"DB_URL must be a MySQL URL, got: {mysql_url!r}")

    src_engine = create_engine(_sqlite_url(sqlite_path), future=True)
    dst_engine = create_engine(mysql_url, future=True, pool_pre_ping=True)
    SrcSession = sessionmaker(bind=src_engine, autoflush=False, autocommit=False)
    DstSession = sessionmaker(bind=dst_engine, autoflush=False, autocommit=False)

    counts: dict[str, int] = {}
    with SrcSession() as src, DstSession() as dst:
        for model in TABLE_MODELS:
            counts[model.__tablename__] = src.query(model).count()

    print("SQLite source counts:")
    for table, count in counts.items():
        print(f"  {table}: {count}")

    if dry_run:
        print("Dry run — no changes written.")
        return counts

    print(f"Overwriting MySQL at {mysql_url.split('@')[-1]} ...")
    _drop_mysql_schema(dst_engine)
    Base.metadata.create_all(dst_engine)

    with SrcSession() as src, DstSession() as dst:
        for model in TABLE_MODELS:
            copied = _copy_table(src, dst, model)
            print(f"  copied {model.__tablename__}: {copied}")

    for table in AUTO_INCREMENT_TABLES:
        _reset_auto_increment(dst_engine, table)

    with DstSession() as dst:
        print("MySQL destination counts:")
        for model in TABLE_MODELS:
            print(f"  {model.__tablename__}: {dst.query(model).count()}")

    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sqlite-path",
        type=Path,
        default=DB_PATH,
        help=f"SQLite jobs.db path (default: {DB_PATH})",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=PROJECT_ROOT / ".env",
        help="Load DB_URL from this env file when not already set",
    )
    parser.add_argument("--dry-run", action="store_true", help="Only print source row counts")
    args = parser.parse_args()

    _load_dotenv(args.env_file)
    mysql_url = os.getenv("DB_URL", "").strip()
    if not mysql_url:
        raise SystemExit("DB_URL is not set; copy .env.example to .env or export DB_URL")

    migrate(sqlite_path=args.sqlite_path, mysql_url=mysql_url, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
