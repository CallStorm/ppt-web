"""Tests for third-party stop_reason normalization (MiniMax etc.)."""
from __future__ import annotations

import unittest

from backend.runner.sync import (
    STOP_OK,
    _finalize_status,
    _stop_reason_from_result,
    normalize_stop_reason,
)


class NormalizeStopReasonTests(unittest.TestCase):
    def test_empty_string_becomes_none(self) -> None:
        self.assertIsNone(normalize_stop_reason(""))

    def test_none_stays_none(self) -> None:
        self.assertIsNone(normalize_stop_reason(None))

    def test_end_turn_unchanged(self) -> None:
        self.assertEqual(normalize_stop_reason("end_turn"), "end_turn")

    def test_max_tokens_unchanged(self) -> None:
        self.assertEqual(normalize_stop_reason("max_tokens"), "max_tokens")

    def test_missing_key_defaults_to_end_turn(self) -> None:
        self.assertEqual(_stop_reason_from_result({}), "end_turn")

    def test_empty_string_in_result_normalized(self) -> None:
        self.assertIsNone(
            _stop_reason_from_result({"stop_reason": "", "terminal_reason": "completed"}),
        )

    def test_none_in_result_normalized(self) -> None:
        self.assertIsNone(_stop_reason_from_result({"stop_reason": None}))


class FinalizeStatusStopReasonTests(unittest.TestCase):
    def test_empty_stop_reason_pauses_with_session(self) -> None:
        status, _, err, refund = _finalize_status(
            pptx=None,
            pptx_error=None,
            options=None,
            stop_reason=normalize_stop_reason(""),
            session_id="sess-1",
            no_progress_bail=False,
        )
        self.assertEqual(status, "paused")
        self.assertIsNone(err)
        self.assertFalse(refund)

    def test_none_stop_reason_pauses_with_session(self) -> None:
        status, _, err, _ = _finalize_status(
            pptx=None,
            pptx_error=None,
            options=None,
            stop_reason=None,
            session_id="sess-1",
            no_progress_bail=False,
        )
        self.assertEqual(status, "paused")
        self.assertIsNone(err)

    def test_end_turn_pauses_with_session(self) -> None:
        status, _, err, _ = _finalize_status(
            pptx=None,
            pptx_error=None,
            options=None,
            stop_reason="end_turn",
            session_id="sess-1",
            no_progress_bail=False,
        )
        self.assertEqual(status, "paused")
        self.assertIsNone(err)

    def test_max_tokens_fails(self) -> None:
        status, _, err, _ = _finalize_status(
            pptx=None,
            pptx_error=None,
            options=None,
            stop_reason="max_tokens",
            session_id="sess-1",
            no_progress_bail=False,
        )
        self.assertEqual(status, "failed")
        self.assertEqual(err, "stop_reason=max_tokens")

    def test_resumable_values_in_stop_ok(self) -> None:
        for value in ("end_turn", None):
            self.assertIn(value, STOP_OK)


if __name__ == "__main__":
    unittest.main()
