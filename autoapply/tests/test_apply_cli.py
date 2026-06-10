"""Tests for autoapply/cli/apply.py — URL parsing, JD fixture parsing, field plan."""

from __future__ import annotations

import io
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

_REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO))

from autoapply.cli import apply  # noqa: E402


VALID_PROFILE = {
    "identity": {
        "first_name": "Sam",
        "last_name": "Rivera",
        "email": "sam@example.com",
        "phone": "+1-555-0100",
        "location_city": "New York",
        "location_state": "NY",
        "location_country": "United States",
        "work_authorization": "US Citizen",
        "willing_to_relocate": False,
        "remote_preference": "Hybrid NYC preferred",
    },
    "links": {
        "linkedin": "https://linkedin.com/in/sam-rivera-example",
        "github": "https://github.com/sam-rivera-example",
        "portfolio": "",
        "resume_url": "https://nick.example.com/resume.pdf",
    },
    "current_role": {
        "company": "Acme AI",
        "title": "Head of BD & Ops",
        "start_date": "2024-09",
        "summary": "BD and Ops",
    },
    "compensation": {"salary_floor_usd": 200000, "salary_target_usd": 240000,
                     "open_to_negotiation": True},
    "recent_projects": [],
    "differentiators": [],
    "answer_style": {"voice": "Direct", "lead_with": "Numbers", "avoid": "Fluff"},
}

PROFILE_WITH_PLACEHOLDERS = {
    **VALID_PROFILE,
    "identity": {**VALID_PROFILE["identity"], "email": "REPLACE_WITH_REAL_EMAIL"},
    "links": {**VALID_PROFILE["links"], "resume_url": "REPLACE_WITH_RESUME_PDF_URL"},
}


class TestParseAshbyUrl(unittest.TestCase):
    def test_canonical_form(self):
        slug, job_id = apply.parse_ashby_url("https://jobs.ashbyhq.com/hebbia-ai/abc-123")
        self.assertEqual(slug, "hebbia-ai")
        self.assertEqual(job_id, "abc-123")

    def test_with_application_suffix(self):
        slug, job_id = apply.parse_ashby_url(
            "https://jobs.ashbyhq.com/relace/xyz-789/application"
        )
        self.assertEqual(slug, "relace")
        self.assertEqual(job_id, "xyz-789")

    def test_rejects_non_ashby_host(self):
        with self.assertRaises(ValueError):
            apply.parse_ashby_url("https://boards.greenhouse.io/anthropic/jobs/1")

    def test_rejects_short_path(self):
        with self.assertRaises(ValueError):
            apply.parse_ashby_url("https://jobs.ashbyhq.com/onlyslug")

    def test_rejects_bad_scheme(self):
        with self.assertRaises(ValueError):
            apply.parse_ashby_url("file:///etc/passwd")


class TestFetchAshbyJd(unittest.TestCase):
    """Mock urllib.request.urlopen to validate parsing of the API JSON shape."""

    def _patch_response(self, payload: dict | list):
        body = json.dumps(payload).encode("utf-8")
        mock_resp = mock.MagicMock()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = lambda s, *a: False
        mock_resp.read = lambda: body
        return mock.patch.object(apply.urllib.request, "urlopen", return_value=mock_resp)

    def test_happy_path(self):
        payload = {
            "jobs": [
                {
                    "id": "abc-123",
                    "title": "GTM Engineer",
                    "descriptionPlain": "Build the revenue engine.",
                    "location": "New York, NY",
                    "isRemote": False,
                    "compensation": {"min": 220000, "max": 260000},
                    "department": "Go-to-Market",
                    "team": "GTM Engineering",
                }
            ]
        }
        with self._patch_response(payload):
            jd = apply.fetch_ashby_jd("hebbia-ai", "abc-123")
        self.assertEqual(jd["title"], "GTM Engineer")
        self.assertEqual(jd["org_slug"], "hebbia-ai")
        self.assertEqual(jd["job_id"], "abc-123")
        self.assertFalse(jd["is_remote"])
        self.assertIn("revenue engine", jd["description"])

    def test_job_not_found_raises(self):
        payload = {"jobs": [{"id": "different-id", "title": "Other"}]}
        with self._patch_response(payload):
            with self.assertRaises(ValueError) as ctx:
                apply.fetch_ashby_jd("hebbia-ai", "missing-id")
            self.assertIn("missing-id", str(ctx.exception))


class TestFieldPlan(unittest.TestCase):
    def test_all_filled_when_profile_valid(self):
        fill, skip = apply.field_plan(VALID_PROFILE)
        fill_fields = {row["form_field"] for row in fill}
        for required in ("first_name", "last_name", "email", "phone",
                         "linkedin", "github", "resume_url",
                         "current_company", "current_title",
                         "work_authorization", "salary_expectations"):
            self.assertIn(required, fill_fields, msg=f"{required} not in fill plan")

        skip_fields = {row["form_field"] for row in skip}
        # portfolio is empty -> should be in skip with reason=empty
        self.assertIn("portfolio", skip_fields)
        portfolio_row = next(r for r in skip if r["form_field"] == "portfolio")
        self.assertEqual(portfolio_row["reason"], "empty")

    def test_placeholders_routed_to_skip(self):
        fill, skip = apply.field_plan(PROFILE_WITH_PLACEHOLDERS)
        fill_fields = {row["form_field"] for row in fill}
        skip_fields = {row["form_field"]: row["reason"] for row in skip}
        self.assertNotIn("email", fill_fields)
        self.assertNotIn("resume_url", fill_fields)
        self.assertEqual(skip_fields["email"], "placeholder")
        self.assertEqual(skip_fields["resume_url"], "placeholder")

    def test_salary_formatting(self):
        fill, _ = apply.field_plan(VALID_PROFILE)
        sal = next(r for r in fill if r["form_field"] == "salary_expectations")
        self.assertEqual(sal["value"], "$200,000+")


class TestRenderReport(unittest.TestCase):
    def test_report_has_required_sections(self):
        fill, skip = apply.field_plan(VALID_PROFILE)
        jd = {"title": "GTM Engineer", "org_slug": "hebbia-ai", "job_id": "abc",
              "location": "NYC", "is_remote": False}
        report = apply.render_report(jd=jd, fill=fill, skip=skip, drafted=[])
        for header in ("SUMMARY", "FILLED", "SKIPPED", "SAFETY TRIGGERS",
                       "READY FOR REVIEW"):
            self.assertIn(header, report, msg=f"missing header: {header}")

    def test_placeholder_blocks_ready_for_review(self):
        fill, skip = apply.field_plan(PROFILE_WITH_PLACEHOLDERS)
        jd = {"title": "X", "org_slug": "y", "job_id": "z",
              "location": "", "is_remote": False}
        report = apply.render_report(jd=jd, fill=fill, skip=skip, drafted=[])
        self.assertIn("READY FOR REVIEW: no", report)
        # The blocking placeholder names must surface in the report so the
        # human knows exactly what to set.
        self.assertIn("identity.email", report)
        self.assertIn("links.resume_url", report)


if __name__ == "__main__":
    unittest.main()
