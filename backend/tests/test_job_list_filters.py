"""Unit tests for job list status/search filters."""
from __future__ import annotations

import sys
import unittest
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from backend.api.routes.jobs import _apply_job_list_filters, _exclude_template_create_jobs  # noqa: E402
from backend.models import Base, Job, User  # noqa: E402


def _seed(session) -> dict[str, str]:
    user = User(
        id=str(uuid.uuid4()),
        email="filter-test@example.com",
        password_hash="x",
        quota_credits=10,
    )
    session.add(user)
    jobs = {
        "queued": Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="queued prompt",
            project_name="Alpha Queued",
            status="queued",
        ),
        "running": Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="running prompt",
            project_name="Beta Running",
            status="running",
        ),
        "paused": Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="paused prompt",
            project_name="Gamma Paused",
            status="paused",
        ),
        "done": Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="marketing deck",
            project_name="Delta Done",
            status="done",
        ),
        "failed": Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="failed prompt",
            project_name="Epsilon Failed",
            status="failed",
        ),
        "cancelled": Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="cancelled prompt",
            project_name="Zeta Cancelled",
            status="cancelled",
        ),
        "template_create": Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="template prompt",
            project_name="Tpl Create",
            status="failed",
            options_json='{"job_type": "template_create", "template_record_id": "x"}',
        ),
    }
    session.add_all(jobs.values())
    session.commit()
    return {key: job.id for key, job in jobs.items()}


class TestJobListFilters(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self):
        self.session = self.Session()
        for table in reversed(Base.metadata.sorted_tables):
            self.session.execute(table.delete())
        self.session.commit()
        self.job_ids = _seed(self.session)
        self.base_query = self.session.query(Job)

    def tearDown(self):
        self.session.close()

    def _statuses(self, status: str | None, q: str | None = None) -> set[str]:
        query = _apply_job_list_filters(self.base_query, status, q)
        rows = query.order_by(Job.project_name).all()
        return {row.status for row in rows}

    def _names(self, status: str | None, q: str | None = None) -> list[str]:
        query = _apply_job_list_filters(self.base_query, status, q)
        rows = query.order_by(Job.project_name).all()
        return [row.project_name for row in rows]

    def test_no_filter_returns_all(self):
        self.assertEqual(len(self._names(None, None)), 7)

    def test_exclude_template_create_from_portfolio(self):
        query = _exclude_template_create_jobs(self.base_query)
        names = [row.project_name for row in query.order_by(Job.project_name).all()]
        self.assertNotIn("Tpl Create", names)
        self.assertEqual(len(names), 6)

    def test_running_includes_queued(self):
        self.assertEqual(self._statuses("running"), {"queued", "running"})

    def test_paused_filter(self):
        self.assertEqual(self._statuses("paused"), {"paused"})

    def test_done_filter(self):
        self.assertEqual(self._statuses("done"), {"done"})

    def test_failed_includes_cancelled(self):
        self.assertEqual(self._statuses("failed"), {"failed", "cancelled"})

    def test_search_by_project_name(self):
        self.assertEqual(self._names(None, "delta"), ["Delta Done"])

    def test_search_by_prompt(self):
        self.assertEqual(self._names(None, "MARKETING"), ["Delta Done"])

    def test_search_and_status_combined(self):
        names = self._names("failed", "epsilon")
        self.assertEqual(names, ["Epsilon Failed"])

    def test_list_order_by_created_at_desc(self):
        user = User(
            id=str(uuid.uuid4()),
            email="sort-test@example.com",
            password_hash="x",
            quota_credits=10,
        )
        self.session.add(user)
        older = Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="older job",
            project_name="Older Job",
            status="done",
            created_at=datetime(2026, 1, 1, 10, 0, 0),
            updated_at=datetime(2026, 6, 1, 12, 0, 0),
        )
        newer = Job(
            id=str(uuid.uuid4()),
            user_id=user.id,
            prompt="newer job",
            project_name="Newer Job",
            status="done",
            created_at=datetime(2026, 6, 1, 10, 0, 0),
            updated_at=datetime(2026, 1, 1, 12, 0, 0),
        )
        self.session.add_all([older, newer])
        self.session.commit()

        rows = (
            self.session.query(Job)
            .filter(Job.user_id == user.id)
            .order_by(Job.created_at.desc(), Job.id.desc())
            .all()
        )
        self.assertEqual([row.project_name for row in rows], ["Newer Job", "Older Job"])


if __name__ == "__main__":
    unittest.main()
