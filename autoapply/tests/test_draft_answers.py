"""Tests for autoapply.draft_answers — mocks the Claude call via injection."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO))

from autoapply import draft_answers  # noqa: E402


SAMPLE_PROFILE = {
    "identity": {"first_name": "Nick", "last_name": "Ruzicka"},
    "current_role": {
        "company": "Linera",
        "title": "Head of Operations & Business Development",
    },
    "recent_projects": [
        {"name": "Linera GTM Signal Engine", "summary": "+18% SQLs, 3x outbound"},
    ],
    "differentiators": ["Sales-origin engineer"],
    "answer_style": {
        "voice": "Direct, terse, no em dashes",
        "lead_with": "Concrete numbers",
        "avoid": "Corporate language, em dashes",
    },
}

SAMPLE_JD = "Senior GTM Engineer at Hebbia. Build automations for revenue."


class TestNeedsDraftedAnswer(unittest.TestCase):
    def test_why_interested_triggers(self):
        self.assertTrue(draft_answers.needs_drafted_answer(
            "Why are you interested in Hebbia?"
        ))

    def test_tell_us_about_yourself_triggers(self):
        self.assertTrue(draft_answers.needs_drafted_answer(
            "Tell us about yourself."
        ))

    def test_recent_project_triggers(self):
        self.assertTrue(draft_answers.needs_drafted_answer(
            "What's a recent project you're proud of?"
        ))

    def test_email_field_does_not_trigger(self):
        self.assertFalse(draft_answers.needs_drafted_answer("Email"))

    def test_empty_returns_false(self):
        self.assertFalse(draft_answers.needs_drafted_answer(""))
        self.assertFalse(draft_answers.needs_drafted_answer(None))


class TestDraftAnswer(unittest.TestCase):
    def test_draft_with_mock(self):
        captured = {}

        def fake_call(prompt, *, api_key, model, max_tokens):
            captured["prompt"] = prompt
            captured["api_key"] = api_key
            captured["model"] = model
            captured["max_tokens"] = max_tokens
            return "Linera ships an L1 chain Anthropic-style; the GTM signal engine I built converts."

        result = draft_answers.draft_answer(
            profile=SAMPLE_PROFILE,
            jd_text=SAMPLE_JD,
            question="Why are you interested in Hebbia?",
            api_key="sk-test",
            _call=fake_call,
        )
        self.assertIn("Linera", result)
        # The prompt must embed the answer_style verbatim.
        self.assertIn("Direct, terse, no em dashes", captured["prompt"])
        self.assertIn("Concrete numbers", captured["prompt"])
        # And must include the JD + the question.
        self.assertIn("Senior GTM Engineer at Hebbia", captured["prompt"])
        self.assertIn("Why are you interested in Hebbia?", captured["prompt"])

    def test_missing_api_key_raises(self):
        # Ensure env doesn't leak in:
        with unittest.mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(draft_answers.DraftError) as ctx:
                draft_answers.draft_answer(
                    profile=SAMPLE_PROFILE, jd_text=SAMPLE_JD,
                    question="Q", api_key=None,
                )
            self.assertIn("ANTHROPIC_API_KEY", str(ctx.exception))

    def test_strips_answer_preamble(self):
        def fake_call(prompt, *, api_key, model, max_tokens):
            return "Answer: Linera's GTM signal engine shipped 3x outbound volume."

        result = draft_answers.draft_answer(
            profile=SAMPLE_PROFILE, jd_text=SAMPLE_JD,
            question="Why?", api_key="sk-test", _call=fake_call,
        )
        self.assertFalse(result.startswith("Answer:"))
        self.assertIn("Linera", result)

    def test_call_failure_propagates(self):
        def fake_call(prompt, *, api_key, model, max_tokens):
            raise draft_answers.DraftError("simulated 529 overloaded")

        with self.assertRaises(draft_answers.DraftError):
            draft_answers.draft_answer(
                profile=SAMPLE_PROFILE, jd_text=SAMPLE_JD,
                question="Q", api_key="sk-test", _call=fake_call,
            )


# Late import — only used in the missing-api-key test.
import unittest.mock  # noqa: E402

if __name__ == "__main__":
    unittest.main()
