"""Tests for spec_lock parsing."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))

from backend.runner.spec_lock import build_spec_summary, parse_lock


class TestSpecLock(unittest.TestCase):
    def test_parse_lock_sections(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "spec_lock.md"
            lock.write_text(
                "## colors\n"
                "- primary: #1565C0\n"
                "- bg: #FFFFFF\n"
                "## typography\n"
                "- font_family: Arial, sans-serif\n"
                "## visual_style\n"
                "- visual_style: swiss-minimal\n",
                encoding="utf-8",
            )
            sections = parse_lock(lock)
            self.assertEqual(sections["colors"]["primary"], "#1565C0")
            self.assertEqual(sections["visual_style"]["visual_style"], "swiss-minimal")

    def test_build_spec_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp)
            (proj / "spec_lock.md").write_text(
                "## colors\n- primary: #111111\n"
                "## visual_style\n- visual_style: dark-tech\n",
                encoding="utf-8",
            )
            summary = build_spec_summary(proj, page_count=5)
            self.assertIsNotNone(summary)
            self.assertEqual(summary["colors"]["primary"], "#111111")
            self.assertEqual(summary["visual_style"], "dark-tech")
            self.assertEqual(summary["page_count"], 5)


if __name__ == "__main__":
    unittest.main()
