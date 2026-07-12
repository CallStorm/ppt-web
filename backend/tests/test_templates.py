"""Tests for template catalog helpers."""
from __future__ import annotations

import json
import shutil
import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from backend.api.schemas.job_options import JobOptions, TemplateRef, job_options_from_form
from backend.app.templates import (
    _find_cover_svg,
    _list_svg_previews,
    discover_template_preview_svgs,
    resolve_preview_file,
)
from backend.app.template_service import (
    delete_template,
    display_name_from_filename,
    finalize_template_job,
    list_template_tasks,
    parse_manifest_analysis,
    retry_template_task,
    slug_base_from_filename,
    slug_is_taken,
    suggest_unique_slug,
    sync_template_on_job_terminal,
    template_output_ready,
    validate_template_brief,
)
from backend.models import Base, Job, Template, TemplateCategory, User


class TemplateOptionsTests(unittest.TestCase):
    def test_beautify_template_scope_system(self) -> None:
        opts = job_options_from_form(
            job_type="beautify",
            template_scope="system",
            template_kind="deck",
            template_id="academic_defense",
        )
        self.assertIsNotNone(opts.template)
        assert opts.template is not None
        self.assertEqual(opts.template.scope, "system")
        self.assertEqual(opts.template.kind, "deck")

    def test_beautify_template_scope_user(self) -> None:
        opts = job_options_from_form(
            job_type="beautify",
            template_scope="user",
            template_kind="layout",
            template_id="my_layout",
        )
        assert opts.template is not None
        self.assertEqual(opts.template.scope, "user")

    def test_template_ref_default_scope(self) -> None:
        ref = TemplateRef(kind="deck", id="foo")
        self.assertEqual(ref.scope, "system")


class ManifestAnalysisTests(unittest.TestCase):
    def test_parse_theme_colors_dict(self) -> None:
        manifest = {
            "source": {"name": "demo.pptx"},
            "slideSize": {"width_px": 1280, "height_px": 720},
            "theme": {
                "colors": {"accent1": "#C8152D", "dk1": "#333333"},
                "fonts": {"majorLatin": "Arial", "minorLatin": "Calibri"},
            },
            "slides": [
                {"index": 0, "pageType": "cover"},
                {"index": 1, "pageType": "content"},
            ],
            "masters": [{}],
            "layouts": [{}, {}],
        }
        native = {"strategy": {"recommendedMode": "preserve"}}
        analysis = parse_manifest_analysis(manifest, native)
        self.assertEqual(analysis["primary_color"], "#C8152D")
        self.assertEqual(analysis["theme_colors"], ["#C8152D", "#333333"])
        self.assertEqual(analysis["fonts"], ["Arial", "Calibri"])
        self.assertEqual(analysis["canvas_width"], 1280)
        self.assertEqual(analysis["page_type_candidates"], ["cover", "content"])
        self.assertEqual(analysis["native_structure_mode"], "preserve")
        self.assertEqual(analysis["title_guess"], "demo")


class FilenameSlugTests(unittest.TestCase):
    def test_display_name_from_filename(self) -> None:
        self.assertEqual(display_name_from_filename("AI语音知识库"), "AI语音知识库")
        self.assertEqual(display_name_from_filename("My_Brand_Deck"), "My Brand Deck")

    def test_slug_base_from_english_filename(self) -> None:
        self.assertEqual(slug_base_from_filename("My_Brand_Deck"), "my_brand_deck")

    def test_slug_base_not_reference_when_stem_differs(self) -> None:
        self.assertEqual(slug_base_from_filename("AI_Voice_KB"), "ai_voice_kb")
        self.assertNotEqual(slug_base_from_filename("AI_Voice_KB"), "reference")


class SuggestUniqueSlugTests(unittest.TestCase):
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
        self.user_id = str(uuid.uuid4())
        self.session.add(
            User(id=self.user_id, email="slug@example.com", password_hash="x", quota_credits=5)
        )
        self.session.add(TemplateCategory(id="my_templates", name="我的模板", scope="system"))
        self.session.commit()

    def tearDown(self):
        self.session.close()

    def test_returns_base_when_free(self) -> None:
        slug, deduped = suggest_unique_slug(
            self.session, base="brand_deck", kind="deck", scope="user", owner_id=self.user_id,
        )
        self.assertEqual(slug, "brand_deck")
        self.assertFalse(deduped)

    def test_suffixes_when_db_row_exists(self) -> None:
        self.session.add(
            Template(
                id=str(uuid.uuid4()),
                slug="brand_deck",
                display_name="Brand",
                kind="deck",
                scope="user",
                owner_user_id=self.user_id,
                category_id="my_templates",
                status="ready",
            )
        )
        self.session.commit()
        slug, deduped = suggest_unique_slug(
            self.session, base="brand_deck", kind="deck", scope="user", owner_id=self.user_id,
        )
        self.assertEqual(slug, "brand_deck_2")
        self.assertTrue(deduped)

    def test_slug_is_taken_for_existing_row(self) -> None:
        self.session.add(
            Template(
                id=str(uuid.uuid4()),
                slug="taken",
                display_name="Taken",
                kind="deck",
                scope="user",
                owner_user_id=self.user_id,
                category_id="my_templates",
                status="generating",
            )
        )
        self.session.commit()
        self.assertTrue(
            slug_is_taken(
                self.session, slug="taken", kind="deck", scope="user", owner_id=self.user_id,
            )
        )


class BriefValidationTests(unittest.TestCase):
    def test_valid_brief(self) -> None:
        validate_template_brief(
            {
                "display_name": "品牌模板",
                "slug": "brand_deck",
                "kind": "deck",
                "replication_mode": "standard",
                "native_structure_mode": "preserve",
                "visual_fidelity": "literal",
                "theme_mode": "light",
                "keywords": ["general", "deck"],
                "summary": "适用于品牌演示",
            },
            is_admin=False,
        )

    def test_rejects_chinese_slug(self) -> None:
        with self.assertRaises(Exception) as ctx:
            validate_template_brief({"display_name": "x", "slug": "品牌", "keywords": ["deck"]}, is_admin=False)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_mirror_requires_template_native_mode(self) -> None:
        with self.assertRaises(Exception) as ctx:
            validate_template_brief(
                {
                    "display_name": "x",
                    "slug": "mirror_tpl",
                    "replication_mode": "mirror",
                    "native_structure_mode": "preserve",
                    "keywords": ["deck"],
                },
                is_admin=False,
            )
        self.assertEqual(ctx.exception.status_code, 422)


class FinalizeTemplateJobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine)
        cls._session_patcher = patch("backend.app.template_service.SessionLocal", cls.Session)
        cls._session_patcher.start()

    @classmethod
    def tearDownClass(cls):
        cls._session_patcher.stop()

    def setUp(self):
        self.session = self.Session()
        for table in reversed(Base.metadata.sorted_tables):
            self.session.execute(table.delete())
        self.session.commit()

        self.user = User(
            id=str(uuid.uuid4()),
            email="tpl-test@example.com",
            password_hash="x",
            quota_credits=10,
        )
        self.session.add(self.user)
        self.session.add(TemplateCategory(id="my_templates", name="我的模板", scope="system"))
        self.session.commit()

        self.template_id = str(uuid.uuid4())
        self.job_id = str(uuid.uuid4())
        self.storage = Path("/tmp/test_tpl_finalize")
        if self.storage.exists():
            shutil.rmtree(self.storage)
        self.storage.mkdir(parents=True, exist_ok=True)
        (self.storage / "design_spec.md").write_text("# spec", encoding="utf-8")
        (self.storage / "01_cover.svg").write_text("<svg/>", encoding="utf-8")

        opts = JobOptions(job_type="template_create", template_record_id=self.template_id)
        self.session.add(
            Template(
                id=self.template_id,
                slug="test_deck",
                display_name="Test Deck",
                kind="deck",
                scope="user",
                owner_user_id=self.user.id,
                category_id="my_templates",
                status="generating",
                storage_path=str(self.storage),
            )
        )
        self.session.add(
            Job(
                id=self.job_id,
                user_id=self.user.id,
                prompt="make template",
                project_name="tpl_test_deck",
                status="running",
                options_json=json.dumps(opts.model_dump()),
            )
        )
        self.session.commit()

    def tearDown(self):
        self.session.close()

    def test_finalize_marks_ready_on_success(self) -> None:
        finalize_template_job(self.job_id, success=True)
        with self.Session() as s:
            row = s.get(Template, self.template_id)
            assert row is not None
            self.assertEqual(row.status, "ready")
            self.assertEqual(row.source_job_id, self.job_id)

    def test_finalize_marks_failed_when_no_preview_svg(self) -> None:
        (self.storage / "01_cover.svg").unlink()
        finalize_template_job(self.job_id, success=True)
        with self.Session() as s:
            row = s.get(Template, self.template_id)
            assert row is not None
            self.assertEqual(row.status, "failed")

    def test_finalize_marks_failed_on_failure(self) -> None:
        finalize_template_job(self.job_id, success=False, error_message="agent stuck")
        with self.Session() as s:
            row = s.get(Template, self.template_id)
            assert row is not None
            self.assertEqual(row.status, "failed")

    def test_template_output_ready_by_marker(self) -> None:
        self.assertTrue(template_output_ready(self.template_id, "done TEMPLATE_CREATE_DONE"))

    def test_template_output_ready_rejects_marker_without_svg(self) -> None:
        (self.storage / "01_cover.svg").unlink()
        self.assertFalse(template_output_ready(self.template_id, "done TEMPLATE_CREATE_DONE"))

    def test_template_output_ready_accepts_svg_flat(self) -> None:
        (self.storage / "01_cover.svg").unlink()
        flat = self.storage / "svg-flat"
        flat.mkdir(exist_ok=True)
        (flat / "slide_01.svg").write_text("<svg/>", encoding="utf-8")
        self.assertTrue(template_output_ready(self.template_id, None))

    def test_list_template_tasks_includes_generating(self) -> None:
        tasks = list_template_tasks(self.session, self.user, is_admin=False)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["status"], "generating")


class RetryTemplateTaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine)
        cls._session_patcher = patch("backend.app.template_service.SessionLocal", cls.Session)
        cls._session_patcher.start()
        cls._notify_patcher = patch("backend.app.template_service.notify_dispatcher")
        cls._notify_patcher.start()

    @classmethod
    def tearDownClass(cls):
        cls._notify_patcher.stop()
        cls._session_patcher.stop()

    def setUp(self):
        self.session = self.Session()
        for table in reversed(Base.metadata.sorted_tables):
            self.session.execute(table.delete())
        self.session.commit()

        self.user = User(
            id=str(uuid.uuid4()),
            email="retry-test@example.com",
            password_hash="x",
            quota_credits=5,
        )
        self.session.add(self.user)
        self.session.add(TemplateCategory(id="my_templates", name="我的模板", scope="system"))
        self.session.commit()

        self.template_id = str(uuid.uuid4())
        self.job_id = str(uuid.uuid4())
        self.storage = Path(f"/tmp/test_tpl_retry_{self.template_id}")
        if self.storage.exists():
            shutil.rmtree(self.storage)
        self.storage.mkdir(parents=True, exist_ok=True)
        (self.storage / "partial.svg").write_text("<svg/>", encoding="utf-8")

        brief = {"summary": "品牌模板描述", "staging_id": "stg-1"}
        opts = JobOptions(job_type="template_create", template_record_id=self.template_id)
        self.session.add(
            Template(
                id=self.template_id,
                slug="retry_deck",
                display_name="Retry Deck",
                kind="deck",
                scope="user",
                owner_user_id=self.user.id,
                category_id="my_templates",
                status="failed",
                summary="品牌模板描述 [failed: agent stuck]",
                brief_json=json.dumps(brief),
                storage_path=str(self.storage),
                source_job_id=self.job_id,
            )
        )
        self.session.add(
            Job(
                id=self.job_id,
                user_id=self.user.id,
                prompt="make template",
                project_name="tpl_retry_deck",
                status="failed",
                error_message="agent stuck",
                options_json=json.dumps(opts.model_dump()),
            )
        )
        self.session.commit()

    def tearDown(self):
        self.session.close()
        shutil.rmtree(self.storage, ignore_errors=True)

    def test_retry_failed_template_resets_states(self) -> None:
        result = retry_template_task(self.session, self.user, self.template_id)
        self.assertEqual(result["status"], "queued")
        self.assertEqual(result["job_id"], self.job_id)
        with self.Session() as s:
            tpl = s.get(Template, self.template_id)
            job = s.get(Job, self.job_id)
            user = s.get(User, self.user.id)
            assert tpl is not None and job is not None and user is not None
            self.assertEqual(tpl.status, "generating")
            self.assertEqual(tpl.summary, "品牌模板描述")
            self.assertEqual(job.status, "queued")
            self.assertIsNone(job.error_message)
            self.assertEqual(user.quota_credits, 4)
        self.assertFalse((self.storage / "partial.svg").exists())

    def test_retry_rejects_non_failed_template(self) -> None:
        with self.Session() as s:
            row = s.get(Template, self.template_id)
            job = s.get(Job, self.job_id)
            assert row is not None and job is not None
            row.status = "generating"
            job.status = "running"
            s.commit()
        with self.assertRaises(Exception) as ctx:
            retry_template_task(self.session, self.user, self.template_id)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("任务进行中", str(ctx.exception.detail))

    def test_retry_heals_desync_failed_job(self) -> None:
        with self.Session() as s:
            row = s.get(Template, self.template_id)
            job = s.get(Job, self.job_id)
            assert row is not None and job is not None
            row.status = "generating"
            row.summary = "品牌模板描述"
            job.status = "failed"
            job.error_message = "watchdog timeout"
            s.commit()
        result = retry_template_task(self.session, self.user, self.template_id)
        self.assertEqual(result["status"], "queued")
        with self.Session() as s:
            tpl = s.get(Template, self.template_id)
            job = s.get(Job, self.job_id)
            assert tpl is not None and job is not None
            self.assertEqual(tpl.status, "generating")
            self.assertEqual(job.status, "queued")

    def test_retry_heals_desync_cancelled_job(self) -> None:
        with self.Session() as s:
            row = s.get(Template, self.template_id)
            job = s.get(Job, self.job_id)
            assert row is not None and job is not None
            row.status = "generating"
            row.summary = "品牌模板描述"
            job.status = "cancelled"
            job.error_message = "user cancelled"
            s.commit()
        result = retry_template_task(self.session, self.user, self.template_id)
        self.assertEqual(result["status"], "queued")
        with self.Session() as s:
            job = s.get(Job, self.job_id)
            assert job is not None
            self.assertEqual(job.status, "queued")

    def test_sync_template_on_job_terminal_marks_generating_failed(self) -> None:
        with self.Session() as s:
            row = s.get(Template, self.template_id)
            job = s.get(Job, self.job_id)
            assert row is not None and job is not None
            row.status = "generating"
            row.summary = "品牌模板描述"
            job.status = "failed"
            job.error_message = "server restart interrupted"
            updated = sync_template_on_job_terminal(s, job)
            self.assertTrue(updated)
            s.commit()
        with self.Session() as s:
            tpl = s.get(Template, self.template_id)
            assert tpl is not None
            self.assertEqual(tpl.status, "failed")
            self.assertIn("[failed:", tpl.summary or "")

    def test_sync_template_on_job_terminal_skips_already_failed(self) -> None:
        with self.Session() as s:
            job = s.get(Job, self.job_id)
            assert job is not None
            job.status = "failed"
            updated = sync_template_on_job_terminal(s, job)
            self.assertFalse(updated)

    def test_retry_rejects_when_quota_exhausted(self) -> None:
        user = self.session.get(User, self.user.id)
        assert user is not None
        user.quota_credits = 0
        self.session.commit()
        with self.assertRaises(Exception) as ctx:
            retry_template_task(self.session, self.user, self.template_id)
        self.assertEqual(ctx.exception.status_code, 402)

    def test_retry_recovers_when_output_already_on_disk(self) -> None:
        (self.storage / "design_spec.md").write_text("# spec", encoding="utf-8")
        (self.storage / "01_cover.svg").write_text("<svg/>", encoding="utf-8")
        result = retry_template_task(self.session, self.user, self.template_id)
        self.assertEqual(result["status"], "ready")
        self.assertTrue(result.get("recovered"))
        with self.Session() as s:
            tpl = s.get(Template, self.template_id)
            job = s.get(Job, self.job_id)
            user = s.get(User, self.user.id)
            assert tpl is not None and job is not None and user is not None
            self.assertEqual(tpl.status, "ready")
            self.assertEqual(job.status, "done")
            self.assertEqual(user.quota_credits, 5)
        self.assertTrue((self.storage / "01_cover.svg").exists())


class TranslatePathsTests(unittest.TestCase):
    def test_translate_template_paths_for_container(self) -> None:
        from backend.paths import (
            CONTAINER_GLOBAL_TEMPLATES_ROOT,
            CONTAINER_MOUNT,
            CONTAINER_STAGING_ROOT,
            CONTAINER_USER_TEMPLATES_ROOT,
            GLOBAL_TEMPLATES_DIR,
            TEMPLATE_STAGING_DIR,
            translate_paths_for_container,
            user_dir,
        )

        uid = "user-abc"
        user_root = user_dir(uid)
        staging = TEMPLATE_STAGING_DIR / "stg-1"
        global_out = GLOBAL_TEMPLATES_DIR / "reference"
        text = (
            f"参考 PPTX: {staging / 'reference.pptx'}\n"
            f"输出: {global_out}\n"
            f"个人: {user_root / 'templates' / 'mine'}\n"
            f"项目: {user_root / 'projects' / 'job-1'}\n"
        )
        out = translate_paths_for_container(text, user_root, mount_path=CONTAINER_MOUNT)
        self.assertIn(f"{CONTAINER_STAGING_ROOT}/stg-1/reference.pptx", out)
        self.assertIn(f"{CONTAINER_GLOBAL_TEMPLATES_ROOT}/reference", out)
        self.assertIn(f"{CONTAINER_USER_TEMPLATES_ROOT}/mine", out)
        self.assertIn(f"{CONTAINER_MOUNT}/projects/job-1", out)
        self.assertNotIn(str(staging), out)


class TemplatePreviewDiscoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(f"/tmp/test_tpl_preview_{uuid.uuid4().hex}")
        self.template_dir = self.root / "my_deck"
        self.template_dir.mkdir(parents=True)
        (self.template_dir / "design_spec.md").write_text("# spec", encoding="utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def test_discover_root_svgs(self) -> None:
        (self.template_dir / "01_cover.svg").write_text("<svg/>", encoding="utf-8")
        (self.template_dir / "02_toc.svg").write_text("<svg/>", encoding="utf-8")
        self.assertEqual(
            discover_template_preview_svgs(self.template_dir),
            ["01_cover.svg", "02_toc.svg"],
        )
        self.assertEqual(_find_cover_svg(self.template_dir), "01_cover.svg")
        self.assertEqual(_list_svg_previews(self.template_dir), ["01_cover.svg", "02_toc.svg"])

    def test_discover_svg_flat_subdir(self) -> None:
        flat = self.template_dir / "svg-flat"
        flat.mkdir()
        (flat / "slide_01.svg").write_text("<svg/>", encoding="utf-8")
        (flat / "slide_02.svg").write_text("<svg/>", encoding="utf-8")
        self.assertEqual(
            discover_template_preview_svgs(self.template_dir),
            ["svg-flat/slide_01.svg", "svg-flat/slide_02.svg"],
        )
        self.assertEqual(_find_cover_svg(self.template_dir), "svg-flat/slide_01.svg")

    def test_resolve_preview_file_subdir(self) -> None:
        flat = self.template_dir / "svg-flat"
        flat.mkdir()
        (flat / "slide_01.svg").write_text("<svg/>", encoding="utf-8")
        user_root = self.root / "user"
        slug_dir = user_root / "my_deck"
        slug_dir.mkdir(parents=True)
        (slug_dir / "design_spec.md").write_text("# spec", encoding="utf-8")
        (slug_dir / "svg-flat").mkdir()
        (slug_dir / "svg-flat" / "slide_01.svg").write_text("<svg/>", encoding="utf-8")
        with patch("backend.app.templates.user_templates_dir", return_value=user_root):
            path = resolve_preview_file(
                "user",
                "deck",
                "my_deck",
                "svg-flat/slide_01.svg",
                user_id="u1",
            )
        self.assertEqual(path.name, "slide_01.svg")


class DeleteTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine)

    def setUp(self) -> None:
        self.session = self.Session()
        for table in reversed(Base.metadata.sorted_tables):
            self.session.execute(table.delete())
        self.session.commit()

        self.user = User(
            id=str(uuid.uuid4()),
            email="delete-test@example.com",
            password_hash="x",
            quota_credits=5,
        )
        self.session.add(self.user)
        self.session.add(TemplateCategory(id="my_templates", name="我的模板", scope="system"))
        self.session.commit()

        self.template_id = str(uuid.uuid4())
        self.job_id = str(uuid.uuid4())
        self.staging_id = f"stg-delete-{uuid.uuid4().hex[:8]}"
        self.storage = Path(f"/tmp/test_tpl_delete_{uuid.uuid4().hex}")
        self.storage.mkdir(parents=True, exist_ok=True)
        (self.storage / "design_spec.md").write_text("# spec", encoding="utf-8")
        (self.storage / "01_cover.svg").write_text("<svg/>", encoding="utf-8")

        staging_dir = ROOT / "data" / "templates" / "staging" / self.staging_id
        staging_dir.mkdir(parents=True, exist_ok=True)
        (staging_dir / "reference.pptx").write_text("pptx", encoding="utf-8")

        brief = {"summary": "待删模板", "staging_id": self.staging_id}
        opts = JobOptions(
            job_type="template_create",
            template_record_id=self.template_id,
            template_staging_id=self.staging_id,
        )
        self.session.add(
            Template(
                id=self.template_id,
                slug="delete_me",
                display_name="Delete Me",
                kind="deck",
                scope="user",
                owner_user_id=self.user.id,
                category_id="my_templates",
                status="ready",
                storage_path=str(self.storage),
                brief_json=json.dumps(brief),
                source_job_id=self.job_id,
            )
        )
        self.session.add(
            Job(
                id=self.job_id,
                user_id=self.user.id,
                prompt="make template",
                project_name="tpl_delete_me",
                status="done",
                options_json=json.dumps(opts.model_dump()),
            )
        )
        self.session.commit()
        self.staging_dir = staging_dir

    def tearDown(self) -> None:
        self.session.close()
        shutil.rmtree(self.storage, ignore_errors=True)
        shutil.rmtree(self.staging_dir, ignore_errors=True)

    def test_delete_template_removes_storage_and_staging(self) -> None:
        delete_template(self.session, self.user, self.template_id)
        self.assertFalse(self.storage.exists())
        self.assertFalse(self.staging_dir.exists())
        with self.Session() as s:
            self.assertIsNone(s.get(Template, self.template_id))


if __name__ == "__main__":
    unittest.main()
