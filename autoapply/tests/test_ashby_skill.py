"""Validates autoapply/skills/ashby/SKILL.md structure + safety rule presence.

The SKILL.md is load-bearing for the safety story — these tests guard the
specific clauses that prevent accidental form submission and placeholder
fills. Future edits that drop a rule will fail the suite, which is the point.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

SKILL_PATH = Path(__file__).resolve().parent.parent / "skills" / "ashby" / "SKILL.md"


class TestAshbySkillStructure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL_PATH.read_text(encoding="utf-8")

    def test_skill_file_exists(self):
        self.assertTrue(SKILL_PATH.exists(), f"missing skill: {SKILL_PATH}")

    def test_yaml_frontmatter(self):
        # Frontmatter must be the first thing in the file.
        self.assertTrue(self.text.startswith("---"))
        # Find the second `---` that closes the frontmatter.
        end = self.text.find("\n---", 4)
        self.assertGreater(end, 0)
        front = self.text[4:end]
        self.assertIn("name: ashby", front)
        self.assertIn("description:", front)

    def test_critical_safety_rules_present(self):
        # All 6 safety rules from Task E spec must appear by number.
        for n in range(1, 7):
            self.assertRegex(
                self.text,
                rf"\b{n}\.\s+\*\*",
                msg=f"safety rule {n} missing or not bolded",
            )

    def test_rule_1_never_submit(self):
        m = re.search(r"1\.\s+\*\*([^*]+)\*\*", self.text)
        self.assertIsNotNone(m)
        self.assertIn("NEVER", m.group(1))
        self.assertIn("Submit", m.group(1))

    def test_rule_2_last_required_field_check(self):
        # Rule 2 — auto-advance footgun fix
        self.assertIn("LAST VISIBLE REQUIRED FIELD", self.text)
        self.assertIn("HALT", self.text)

    def test_rule_3_multi_step_form(self):
        self.assertIn("Multi-step forms", self.text)
        self.assertIn("STOP before clicking", self.text)

    def test_rule_4_confidence_gate(self):
        self.assertIn("Confidence gate", self.text)
        self.assertIn("leave it BLANK", self.text)

    def test_rule_5_consent_checkbox(self):
        self.assertIn("Consent / agreement checkboxes", self.text)
        self.assertIn("explicit human approval", self.text)

    def test_rule_6_placeholder_guard(self):
        # The PLACEHOLDER GUARD rule must mention both REPLACE_WITH_ and XX,
        # and reference is_placeholder() for the single source of truth.
        self.assertIn("PLACEHOLDER GUARD", self.text)
        self.assertIn("REPLACE_WITH_", self.text)
        self.assertIn("two-or-more consecutive Xs", self.text)
        self.assertIn("is_placeholder", self.text)

    def test_eeo_blanks_required(self):
        # EEO questions must be blanked, not heuristically filled.
        self.assertIn("Demographics / EEO", self.text)
        self.assertIn("leave EVERY field blank", self.text)

    def test_reports_back_section(self):
        self.assertIn("Reporting back", self.text)
        self.assertIn("FILLED", self.text)
        self.assertIn("SKIPPED", self.text)
        self.assertIn("READY FOR REVIEW", self.text)


if __name__ == "__main__":
    unittest.main()
