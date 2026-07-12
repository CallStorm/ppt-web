"""Tests for beautify PPTX resolution and completion guards."""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from backend.api.schemas.job_options import JobOptions, TemplateRef
from backend.runner.preview import list_slides
from backend.runner.stages import (
    beautify_output_ready,
    find_pptx,
)
from backend.runner.sync import _resolve_pptx


class FindPptxTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="test_find_pptx_"))
        self.project = self.root / "deck_ppt169_20260712"
        self.project.mkdir(parents=True)
        (self.project / "sources").mkdir()
        (self.project / "exports").mkdir()
        (self.project / "templates").mkdir()
        (self.project / "sources" / "source.pptx").write_bytes(b"source")
        (self.project / "templates" / "layout.pptx").write_bytes(b"tpl")
        (self.project / "exports" / "deck.pptx").write_bytes(b"export")

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def test_beautify_ignores_sources_pptx(self) -> None:
        (self.project / "exports" / "deck.pptx").unlink()
        hit = find_pptx(self.root, project_name="deck", beautify=True)
        self.assertIsNone(hit)

    def test_beautify_returns_exports_only(self) -> None:
        hit = find_pptx(self.root, project_name="deck", beautify=True)
        self.assertEqual(hit, self.project / "exports" / "deck.pptx")

    def test_generate_prefers_exports_over_sources(self) -> None:
        hit = find_pptx(self.root, project_name="deck", beautify=False)
        self.assertEqual(hit, self.project / "exports" / "deck.pptx")

    def test_generate_excludes_sources_when_no_export(self) -> None:
        (self.project / "exports" / "deck.pptx").unlink()
        hit = find_pptx(self.root, project_name="deck", beautify=False)
        self.assertIsNone(hit)


class BeautifyOutputReadyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="test_beautify_ready_"))
        self.project = self.root / "deck_ppt169_20260712"
        self.project.mkdir(parents=True)
        (self.project / "analysis").mkdir()
        (self.project / "exports").mkdir()
        (self.project / "svg_final").mkdir()
        inv = {"schema": "beautify_inventory.v1", "slide_count": 3}
        (self.project / "analysis" / "beautify_inventory.json").write_text(
            json.dumps(inv), encoding="utf-8",
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def test_requires_export_and_full_svg_roster(self) -> None:
        for i in range(1, 4):
            (self.project / "svg_final" / f"{i:02d}_page.svg").write_text("<svg/>", encoding="utf-8")
        (self.project / "exports" / "deck.pptx").write_bytes(b"export")
        ready, err = beautify_output_ready(self.project)
        self.assertTrue(ready)
        self.assertEqual(err, "")

    def test_fails_without_export(self) -> None:
        (self.project / "svg_final" / "01_cover.svg").write_text("<svg/>", encoding="utf-8")
        ready, err = beautify_output_ready(self.project)
        self.assertFalse(ready)
        self.assertIn("exports", err)

    def test_fails_when_slide_count_incomplete(self) -> None:
        (self.project / "svg_final" / "01_cover.svg").write_text("<svg/>", encoding="utf-8")
        (self.project / "exports" / "deck.pptx").write_bytes(b"export")
        ready, err = beautify_output_ready(self.project)
        self.assertFalse(ready)
        self.assertIn("1/3", err)


class ResolvePptxTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="test_resolve_pptx_"))
        self.project = self.root / "deck_ppt169_20260712"
        self.project.mkdir(parents=True)
        (self.project / "analysis").mkdir()
        (self.project / "sources").mkdir()
        (self.project / "exports").mkdir()
        (self.project / "svg_final").mkdir()
        (self.project / "sources" / "source.pptx").write_bytes(b"source")
        inv = {"schema": "beautify_inventory.v1", "slide_count": 2}
        (self.project / "analysis" / "beautify_inventory.json").write_text(
            json.dumps(inv), encoding="utf-8",
        )
        self.opts = JobOptions(
            job_type="beautify",
            template=TemplateRef(scope="system", kind="deck", id="ai_ops"),
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def test_sources_only_beautify_is_not_done(self) -> None:
        (self.project / "svg_final" / "01_cover.svg").write_text("<svg/>", encoding="utf-8")
        pptx, err = _resolve_pptx(self.root, "deck", self.project, self.opts)
        self.assertIsNone(pptx)
        self.assertIn("exports", err or "")

    def test_partial_beautify_with_export_still_fails(self) -> None:
        (self.project / "svg_final" / "01_cover.svg").write_text("<svg/>", encoding="utf-8")
        (self.project / "exports" / "deck.pptx").write_bytes(b"export")
        pptx, err = _resolve_pptx(self.root, "deck", self.project, self.opts)
        self.assertIsNone(pptx)
        self.assertIn("1/2", err or "")


class ListSlidesFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="test_list_slides_"))
        self.project = self.root / "deck"
        self.project.mkdir(parents=True)
        out = self.project / "svg_output"
        out.mkdir()
        (out / "01_cover.svg").write_text("<svg/>", encoding="utf-8")
        (out / "02_content.svg").write_text("<svg/>", encoding="utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def test_falls_back_to_svg_output_when_final_missing(self) -> None:
        slides = list_slides(self.project)
        self.assertEqual(len(slides), 2)

    def test_merges_extra_svg_output_pages(self) -> None:
        final = self.project / "svg_final"
        final.mkdir()
        (final / "01_cover.svg").write_text("<svg/>", encoding="utf-8")
        slides = list_slides(self.project)
        self.assertEqual(len(slides), 2)
        self.assertEqual(slides[1]["name"], "content")


if __name__ == "__main__":
    unittest.main()
