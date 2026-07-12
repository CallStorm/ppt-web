"""Unit tests for conversational PPT creation orchestrator."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from backend.app import chat_orchestrator as orch  # noqa: E402


class TestChatOrchestrator(unittest.TestCase):
    def test_empty_draft_not_ready(self):
        d = orch.empty_draft()
        self.assertFalse(orch._draft_ready(d))

    def test_draft_ready_when_all_phases_done(self):
        d = orch.empty_draft()
        d["core_topic"] = "Test Topic"
        d["outline"] = [{"id": "p1", "title": "Cover", "bullets": []}]
        d["options"]["page_count"] = 5
        d["phase_completed"] = {
            "requirements": True,
            "outline": True,
            "style": True,
        }
        self.assertTrue(orch._draft_ready(d))

    def test_apply_requirements_submit_sets_phase_fields(self):
        d = orch.empty_draft()
        d["core_topic"] = "AI 产品"
        patch = orch.apply_requirements_submit(
            d,
            {"page_count": 8, "scenario": "product", "need_images": True},
        )
        self.assertTrue(patch["phase_completed"]["requirements"])
        self.assertEqual(patch["options"]["page_count"], 8)
        self.assertGreater(len(patch["outline"]), 0)

    def test_draft_to_job_form_maps_outline_titles(self):
        d = orch.empty_draft()
        d["core_topic"] = "Hello"
        d["outline"] = [
            {"id": "p1", "title": "封面", "bullets": []},
            {"id": "p2", "title": "内容", "bullets": []},
        ]
        d["options"]["page_count"] = 2
        form = orch.draft_to_job_form(d)
        self.assertEqual(form["job_type"], "generate")
        self.assertEqual(form["outline"], ["封面", "内容"])
        self.assertEqual(form["core_topic"], "Hello")

    def test_parse_and_dump_roundtrip(self):
        d = orch.empty_draft()
        d["core_topic"] = "Roundtrip"
        raw = orch.dump_draft(d)
        parsed = orch.parse_draft(raw)
        self.assertEqual(parsed["core_topic"], "Roundtrip")

    def test_detect_generate_intent(self):
        d = orch.empty_draft()
        d["core_topic"] = "X"
        d["outline"] = [{"id": "p1", "title": "A", "bullets": []}]
        d["options"]["page_count"] = 5
        d["phase_completed"] = {"requirements": True, "outline": True, "style": True}
        intent = orch._detect_intent("就按这个生成吧", "style", d)
        self.assertEqual(intent, "ready")

    def test_draft_to_job_form_fixes_industry_color_mode(self):
        d = orch.empty_draft()
        d["core_topic"] = "Test"
        d["outline"] = [{"id": "p1", "title": "A", "bullets": []}]
        d["options"]["color_mode"] = "industry"
        d["options"]["industry"] = None
        form = orch.draft_to_job_form(d)
        self.assertEqual(form["color_mode"], "industry")
        self.assertEqual(form["industry"], "technology")

        from backend.api.schemas.job_options import job_options_from_form

        opts = job_options_from_form(**form)
        self.assertEqual(opts.industry, "technology")


if __name__ == "__main__":
    unittest.main()
