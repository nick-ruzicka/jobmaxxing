"""Tests for autoapply.profile_bridge."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

# Ensure repo root is importable.
_REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO))

from autoapply import profile_bridge  # noqa: E402


class TestIsPlaceholder(unittest.TestCase):
    def test_replace_with_prefix(self):
        self.assertTrue(profile_bridge.is_placeholder("REPLACE_WITH_REAL_EMAIL"))
        self.assertTrue(profile_bridge.is_placeholder("REPLACE_WITH_RESUME_PDF_URL"))

    def test_replace_with_case_insensitive(self):
        self.assertTrue(profile_bridge.is_placeholder("replace_with_phone"))
        self.assertTrue(profile_bridge.is_placeholder("Replace_With_Start_Date"))

    def test_double_x_detection(self):
        self.assertTrue(profile_bridge.is_placeholder("2024-XX"))
        self.assertTrue(profile_bridge.is_placeholder("some-xx-thing"))
        self.assertTrue(profile_bridge.is_placeholder("XXXX"))

    def test_real_values_pass(self):
        self.assertFalse(profile_bridge.is_placeholder("Nick"))
        self.assertFalse(profile_bridge.is_placeholder("nick@example.com"))
        self.assertFalse(profile_bridge.is_placeholder("https://linkedin.com/in/foo"))
        self.assertFalse(profile_bridge.is_placeholder(""))

    def test_non_string_values_pass(self):
        self.assertFalse(profile_bridge.is_placeholder(None))
        self.assertFalse(profile_bridge.is_placeholder(42))
        self.assertFalse(profile_bridge.is_placeholder(True))
        self.assertFalse(profile_bridge.is_placeholder([]))

    def test_single_x_not_flagged(self):
        # A lone X (e.g., in "X.AI" or "Excellent") should NOT trip the guard.
        self.assertFalse(profile_bridge.is_placeholder("X.AI"))
        self.assertFalse(profile_bridge.is_placeholder("Excellent"))


class TestGetProfile(unittest.TestCase):
    def test_loads_valid_profile(self):
        # Write a tiny profile to a temp file and pass it via injection seam.
        tmp = self._tmpfile("valid_profile.json")
        tmp.write_text(
            json.dumps({"identity": {"first_name": "Nick"}}), encoding="utf-8"
        )
        prof = profile_bridge.get_profile(profile_path=tmp)
        self.assertEqual(prof["identity"]["first_name"], "Nick")

    def test_missing_profile_raises(self):
        tmp = self._tmpfile("does_not_exist.json")
        # Make sure the file truly doesn't exist:
        if tmp.exists():
            tmp.unlink()
        with self.assertRaises(profile_bridge.ProfileError) as ctx:
            profile_bridge.get_profile(profile_path=tmp)
        self.assertIn("profile not found", str(ctx.exception))
        self.assertIn("REPLACE_WITH", str(ctx.exception))

    def test_malformed_json_raises(self):
        tmp = self._tmpfile("bad.json")
        tmp.write_text("not json", encoding="utf-8")
        with self.assertRaises(profile_bridge.ProfileError) as ctx:
            profile_bridge.get_profile(profile_path=tmp)
        self.assertIn("parse error", str(ctx.exception))

    def test_example_profile_loads(self):
        """The committed profile.json.example must always load cleanly — it's
        the documented starting point for new contributors."""
        prof = profile_bridge.get_profile(
            profile_path=profile_bridge.PROFILE_EXAMPLE_PATH
        )
        # Spot-check required top-level keys
        for key in ("identity", "links", "current_role", "compensation",
                    "recent_projects", "differentiators", "answer_style"):
            self.assertIn(key, prof, msg=f"example profile missing top-level key: {key}")
        # answer_style must include the no-em-dashes rule (Nick's voice constraint)
        avoid = prof["answer_style"]["avoid"].lower()
        self.assertIn("em dashes", avoid)

    def _tmpfile(self, name: str) -> Path:
        d = Path(__file__).resolve().parent / "_tmp"
        d.mkdir(exist_ok=True)
        return d / name


class TestAppliedCompanies(unittest.TestCase):
    def test_extracts_bullet_items(self):
        md = """\
- [Hebbia](https://hebbia.com) — 2026-05-10 — applied
- Plaid — 2026-04-01 — interview
- some other line
- [OpenAI](https://openai.com) | 2026-05-13 | offer
"""
        names = profile_bridge.applied_companies(applications_md=md)
        self.assertIn("Hebbia", names)
        self.assertIn("Plaid", names)
        self.assertIn("OpenAI", names)

    def test_empty_md_returns_empty_set(self):
        self.assertEqual(profile_bridge.applied_companies(applications_md=""), set())


if __name__ == "__main__":
    unittest.main()
