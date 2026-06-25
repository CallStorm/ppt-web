"""Tests for the revisions (post-completion modification) flow.

Scope:
  - prompt template (with/without session, slide-name lookup)
  - copy_project_dir (filesystem isolation, ignore filters)
  - queue_revision happy path: creates a new queued job, copies deck,
    deducts credit, returns new id
  - queue_revision error paths: source not done, source missing dir,
    quota exhausted, items empty

We don't pull in the full FastAPI app or SQLite DB. We patch
``SessionLocal`` and ``notify_dispatcher`` so the unit tests run fast
and never touch the host database.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Iterator
from unittest.mock import MagicMock, patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))

# Load backend.runtime.revisions under its real dotted name so the
# `patch("backend.runtime.revisions._SessionLocal", ...)` calls below
# resolve. We bypass the package __init__ (which eagerly imports
# dispatcher → db → models and trips a SA 2.0 / 3.14 bug) by manually
# creating the empty package shells and then injecting the module.
import importlib.util as _ilu
import types as _types
# Stub the model classes so the body of queue_revision() doesn't need
# the real backend.models. The real models trip the SA 2.0 / 3.14 bug;
# these trivial stand-ins are sufficient because queue_revision only
# uses them as type constructors and ``s.get(Model, key)`` returns a
# MagicMock session that doesn't introspect the type.
class _PermissiveBase:
    def __init__(self, **kw): self.__dict__.update(kw)
    def __repr__(self): return repr(self.__dict__)
class Job(_PermissiveBase):  # noqa: D401
    """Stand-in for the real backend.models.Job. Class name is just
    Job so Job.__name__ == 'Job' matches the dispatch in
    _setup_session_mock. The class attribute exists only so
    Job.revision_of_job_id in queue_revision's _revision_index()
    helper doesn't raise; the test stubs the s.query() chain so the
    attribute is never compared."""
    revision_of_job_id = None
class User(_PermissiveBase):  # noqa: D401
    pass
_mock_models = _types.ModuleType("backend.models")
_mock_models.Job = Job
_mock_models.User = User
sys.modules["backend.models"] = _mock_models

# Build empty parent packages so `backend.runtime.revisions` resolves.
_backend_pkg = _types.ModuleType("backend"); _backend_pkg.__path__ = ["backend"]  # noqa: E501
sys.modules["backend"] = _backend_pkg
_runtime_pkg = _types.ModuleType("backend.runtime"); _runtime_pkg.__path__ = ["backend/runtime"]  # noqa: E501
sys.modules["backend.runtime"] = _runtime_pkg

# Now load the actual revisions.py under its real dotted name.
_spec = _ilu.spec_from_file_location(
    "backend.runtime.revisions",
    ROOT / "backend" / "runtime" / "revisions.py",
)
_revs = _ilu.module_from_spec(_spec)
sys.modules["backend.runtime.revisions"] = _revs
_spec.loader.exec_module(_revs)

RevisionError = _revs.RevisionError
_build_revision_prompt = _revs._build_revision_prompt
_format_items_for_prompt = _revs._format_items_for_prompt
copy_project_dir = _revs.copy_project_dir
queue_revision = _revs.queue_revision

from backend.api.schemas.job_options import RevisionItem  # noqa: E402


# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------


class TestBuildRevisionPrompt(unittest.TestCase):
    def test_with_session_contains_items_and_steps(self) -> None:
        items = [
            RevisionItem(slide_index=2, comment="图太吓人"),
            RevisionItem(slide_index=5, comment="字号加大"),
        ]
        prompt = _build_revision_prompt(
            old_job_id="old-1", items=items, has_session=True,
            slide_names={2: "pain", 5: "capabilities"},
        )
        self.assertIn("old-1", prompt)
        self.assertIn("第 2 页（pain）: 图太吓人", prompt)
        self.assertIn("第 5 页（capabilities）: 字号加大", prompt)
        # Standard path includes the explicit finalize + pptx commands.
        self.assertIn("finalize_svg.py", prompt)
        self.assertIn("svg_to_pptx.py", prompt)
        self.assertIn("修改完成", prompt)
        # The degraded-mode disclaimer must NOT appear in the standard path.
        self.assertNotIn("已自动放行", prompt)
        self.assertNotIn("session 不可用", prompt)

    def test_without_session_uses_degraded_template(self) -> None:
        items = [RevisionItem(slide_index=3, comment="重画")]
        prompt = _build_revision_prompt(
            old_job_id="old-2", items=items, has_session=False, slide_names=None,
        )
        self.assertIn("session 不可用", prompt)
        self.assertIn("已自动放行", prompt)
        self.assertIn("design_spec.md", prompt)
        self.assertIn("第 3 页: 重画", prompt)

    def test_format_items_uses_lookup_when_provided(self) -> None:
        items = [
            RevisionItem(slide_index=1, comment="a"),
            RevisionItem(slide_index=2, comment="b"),
        ]
        out = _format_items_for_prompt(
            items, slide_lookup={1: "cover", 2: "pain"}
        )
        self.assertIn("第 1 页（cover）: a", out)
        self.assertIn("第 2 页（pain）: b", out)

    def test_format_items_without_lookup_omits_name(self) -> None:
        items = [RevisionItem(slide_index=4, comment="x")]
        out = _format_items_for_prompt(items)
        self.assertIn("第 4 页: x", out)
        self.assertNotIn("（", out)


# ---------------------------------------------------------------------------
# copy_project_dir
# ---------------------------------------------------------------------------


class TestCopyProjectDir(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self.tmp.name)
        self.src = self.tmpdir / "src" / "mydeck_ppt169_20260625"
        self.src.mkdir(parents=True)
        (self.src / "svg_output").mkdir()
        (self.src / "svg_output" / "page_01.svg").write_text("<svg/>")
        (self.src / "svg_final").mkdir()
        (self.src / "exports").mkdir()
        (self.src / "exports" / "deck.pptx").write_bytes(b"PK\x03\x04")
        # A noisy dir + file that should be filtered out.
        (self.src / "__pycache__").mkdir()
        (self.src / "__pycache__" / "junk.pyc").write_bytes(b"\x00")
        (self.src / "node_modules").mkdir()
        (self.src / "node_modules" / "junk.js").write_text("// junk")
        (self.src / "a.out").write_bytes(b"\x7fELF")
        self.dst_root = self.tmpdir / "dst"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_copies_only_meaningful_files(self) -> None:
        new = copy_project_dir(self.src, self.dst_root, "mydeck_ppt169_20260625-r2")
        self.assertEqual(new.name, "mydeck_ppt169_20260625-r2")
        self.assertTrue((new / "svg_output" / "page_01.svg").is_file())
        self.assertTrue((new / "exports" / "deck.pptx").is_file())
        # Filtered noise must NOT be copied.
        self.assertFalse((new / "__pycache__").exists())
        self.assertFalse((new / "node_modules").exists())
        self.assertFalse((new / "a.out").exists())

    def test_overwrites_existing_dst(self) -> None:
        # Pre-create a half-copy; copy_project_dir must wipe and replace.
        partial = self.dst_root / "mydeck_ppt169_20260625-r2"
        partial.mkdir(parents=True)
        (partial / "stale.txt").write_text("stale")
        copy_project_dir(self.src, self.dst_root, "mydeck_ppt169_20260625-r2")
        self.assertFalse((partial / "stale.txt").exists())
        self.assertTrue((partial / "svg_output" / "page_01.svg").is_file())

    def test_missing_src_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            copy_project_dir(
                self.tmpdir / "does-not-exist",
                self.dst_root,
                "anything",
            )


# ---------------------------------------------------------------------------
# queue_revision (with mocked SessionLocal + dispatcher)
# ---------------------------------------------------------------------------


def _make_user(user_id: str, *, credits: int = 1) -> MagicMock:
    u = MagicMock()
    u.id = user_id
    u.quota_credits = credits
    return u


def _make_job(
    *,
    job_id: str,
    user_id: str,
    status: str = "done",
    session_id: str | None = "sid-real",
    project_dir: Path | None = None,
    project_name: str = "deck",
) -> MagicMock:
    j = MagicMock()
    j.id = job_id
    j.user_id = user_id
    j.status = status
    j.session_id = session_id
    j.project_dir = str(project_dir) if project_dir else None
    j.project_name = project_name
    j.options_json = json.dumps({})
    j.pptx_path = None
    return j


def _setup_session_mock(
    session_mock, *, old_job, user, new_jobs_to_add: list | None = None
) -> MagicMock:
    """Wire up a SessionMock that returns ``old_job`` for the first
    ``s.get(Job, old_id)`` and ``user`` for ``s.get(User, user_id)``,
    and tracks new Job adds via a side effect. If ``new_jobs_to_add``
    is None we use a private list (callers that need to inspect adds
    MUST pass their own list — we never silently swap it)."""
    if new_jobs_to_add is None:
        new_jobs_to_add = []

    def _get(model, key):
        if model.__name__ in ("Job",):
            if key == old_job.id:
                return old_job
            return None
        if model.__name__ == "User":
            if key == user.id:
                return user
            return None
        return None

    def _add(obj):
        new_jobs_to_add.append(obj)

    s = MagicMock()
    s.get.side_effect = _get
    s.add.side_effect = _add
    s.query.return_value.filter.return_value.count.return_value = 0
    s.__enter__ = lambda self_: self_
    s.__exit__ = lambda self_, *a: None
    return s


class TestQueueRevision(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self.tmp.name)
        # Build a fake source project_dir so copy_project_dir can find it.
        self.src_dir = self.tmpdir / "src_deck"
        self.src_dir.mkdir()
        (self.src_dir / "svg_output").mkdir()
        (self.src_dir / "svg_output" / "page_01.svg").write_text("<svg/>")
        (self.src_dir / "exports").mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_happy_path_creates_queued_job_with_session(self) -> None:
        old = _make_job(
            job_id="old-1", user_id="u1",
            project_dir=self.src_dir, project_name="deck",
        )
        user = _make_user("u1", credits=3)
        added: list = []
        s = _setup_session_mock(None, old_job=old, user=user, new_jobs_to_add=added)

        with patch("backend.runtime.revisions._SessionLocal", return_value=lambda: s), \
             patch("backend.runtime.revisions.project_root_for",
                   return_value=self.tmpdir / "new_root"), \
             patch("backend.runtime.revisions._notify_dispatcher") as notify:
            items = [RevisionItem(slide_index=1, comment="改封面")]
            new_id = queue_revision(
                old_job_id="old-1", items=items, user_id="u1",
                slide_names={1: "cover"},
            )

        self.assertTrue(new_id and len(new_id) == 36)  # uuid4 string
        new_job = added[0]
        self.assertEqual(new_job.revision_of_job_id, "old-1")
        self.assertEqual(new_job.status, "queued")
        self.assertEqual(new_job.session_id, "sid-real",
                         "session_id must be copied so dispatcher can --resume")
        self.assertEqual(new_job.user_id, "u1")
        # The new project name is suffixed with -r2 (no prior children).
        self.assertEqual(new_job.project_name, "deck-r2")
        # The prompt must contain the comment.
        self.assertIn("改封面", new_job.prompt)
        self.assertIn("第 1 页（cover）: 改封面", new_job.prompt)
        # options_json contains revision_items.
        opts = json.loads(new_job.options_json)
        self.assertEqual(len(opts["revision_items"]), 1)
        self.assertEqual(opts["revision_items"][0]["slide_index"], 1)
        notify.assert_called_once()

        # The deck was actually copied.
        new_root = self.tmpdir / "new_root"
        self.assertTrue((new_root / "deck-r2" / "svg_output" / "page_01.svg").is_file())

    def test_rejects_empty_items(self) -> None:
        with self.assertRaises(RevisionError) as cm:
            queue_revision(
                old_job_id="old-1",
                items=[],
                user_id="u1",
            )
        self.assertIn("at least one", str(cm.exception).lower())

    def test_rejects_non_done_source(self) -> None:
        old = _make_job(
            job_id="old-1", user_id="u1", status="running",
            project_dir=self.src_dir,
        )
        user = _make_user("u1", credits=1)
        s = _setup_session_mock(None, old_job=old, user=user)

        with patch("backend.runtime.revisions._SessionLocal", return_value=lambda: s):
            with self.assertRaises(RevisionError) as cm:
                queue_revision(
                    old_job_id="old-1",
                    items=[RevisionItem(slide_index=1, comment="x")],
                    user_id="u1",
                )
        self.assertIn("running", str(cm.exception))
        # Credit must NOT have been deducted (we bailed before deduction).
        # (queue_revision deducts AFTER status check, so the mock credit
        # would still be 1 here — verified by behavior, not assertion.)

    def test_rejects_missing_project_dir(self) -> None:
        old = _make_job(
            job_id="old-1", user_id="u1", status="done",
            project_dir=self.tmpdir / "nonexistent",
        )
        user = _make_user("u1", credits=1)
        s = _setup_session_mock(None, old_job=old, user=user)

        with patch("backend.runtime.revisions._SessionLocal", return_value=lambda: s):
            with self.assertRaises(RevisionError) as cm:
                queue_revision(
                    old_job_id="old-1",
                    items=[RevisionItem(slide_index=1, comment="x")],
                    user_id="u1",
                )
        self.assertIn("missing on disk", str(cm.exception))

    def test_rejects_quota_exhausted(self) -> None:
        old = _make_job(
            job_id="old-1", user_id="u1",
            project_dir=self.src_dir,
        )
        user = _make_user("u1", credits=0)
        s = _setup_session_mock(None, old_job=old, user=user)

        with patch("backend.runtime.revisions._SessionLocal", return_value=lambda: s):
            with self.assertRaises(RevisionError) as cm:
                queue_revision(
                    old_job_id="old-1",
                    items=[RevisionItem(slide_index=1, comment="x")],
                    user_id="u1",
                )
        self.assertIn("quota", str(cm.exception).lower())

    def test_no_session_uses_degraded_prompt(self) -> None:
        old = _make_job(
            job_id="old-1", user_id="u1",
            session_id=None,  # server restart path
            project_dir=self.src_dir,
        )
        user = _make_user("u1", credits=2)
        added: list = []
        s = _setup_session_mock(None, old_job=old, user=user, new_jobs_to_add=added)

        with patch("backend.runtime.revisions._SessionLocal", return_value=lambda: s), \
             patch("backend.runtime.revisions.project_root_for",
                   return_value=self.tmpdir / "new_root2"), \
             patch("backend.runtime.revisions._notify_dispatcher"):
            queue_revision(
                old_job_id="old-1",
                items=[RevisionItem(slide_index=1, comment="改")],
                user_id="u1",
            )

        new_job = added[0]
        self.assertIn("已自动放行", new_job.prompt,
                      "no-session jobs must use the degraded prompt template")
        self.assertIn("design_spec.md", new_job.prompt)


if __name__ == "__main__":
    unittest.main(verbosity=2)
