"""Tests for the resume parser, HTML emitter, and library aggregator.

Tests run against fixture text — no PDF dependency. pdfplumber lives in the
CLI, separate from the parsing logic.
"""

from __future__ import annotations

import os
import sys
import unittest

# Make the autoapply package importable when this file is run via unittest discover.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from autoapply.resume_parser import (
    parse_resume_text,
    extract_bullet_tags,
    extract_impact_metrics,
    slug_company,
)
from autoapply.resume_html_writer import render_resume_html
from autoapply.resume_library import build_library


# ─── fixtures ─────────────────────────────────────────────────────────────────


FIXTURE_NEW_FORMAT = """Jane Doe
GTM Engineer building AI-native systems for revenue teams
San Francisco, CA • jane@example.com • (555) 123-4567 • LinkedIn • GitHub
EXPERIENCE
ACME CORP (AI-Native CRM) San Francisco, CA
GTM Engineer & RevOps Lead 2024 – Present
• Built a custom signal-routing pipeline on Supabase + Next.js that drove +18% SQLs
and 3x outbound velocity by feeding HubSpot via API
• Shipped a Claude-powered lead-scoring model that reduced research time 85% across
50+ accounts per week
LITTLE STARTUP New York, NY
Founding RevOps Engineer 2022 – 2024
• Built the first $1.8M of ARR by hand and codified the playbook in HubSpot + Clay
• Designed pricing model with 30% lift in conversion
EDUCATION
University of Somewhere — Bachelor of Arts, Philosophy 2016 – 2020
SKILLS
Technical: Python, JavaScript, TypeScript, React, Supabase
GTM Stack: Salesforce, HubSpot, Clay, Apollo
"""

FIXTURE_OLD_FORMAT = """John Smith
123 Main Street, New York, NY | john@example.com | (555) 555-1234 | LinkedIn
EXPERIENCE
COMPANY ONE (Web3 Infra) New York, NY
Head of Business Development 2024 – Present
• Closed 20+ partnerships with institutional Web3 firms including Coinbase Institutional
COMPANY TWO Brooklyn, NY
Senior BD 2020 – 2024
• Drove $501K ARR
EDUCATION
COMPANY THREE UNIVERSITY (Some U.) Los Angeles, CA
Bachelor of Arts | Notes 2014 – 2018
• Studied things
SKILLS & INTERESTS
Technical: Python and SQL
"""


# ─── parser ───────────────────────────────────────────────────────────────────


class ParseResumeTextTests(unittest.TestCase):
    def test_new_format_identity(self):
        parsed = parse_resume_text(FIXTURE_NEW_FORMAT)
        ident = parsed["identity"]
        self.assertEqual(ident["name"], "Jane Doe")
        self.assertIn("AI-native systems", ident["subtitle"])
        self.assertEqual(ident["location"], "San Francisco, CA")
        self.assertEqual(ident["email"], "jane@example.com")
        self.assertEqual(ident["phone"], "(555) 123-4567")
        self.assertEqual(ident["linkedin"], "LinkedIn")
        self.assertEqual(ident["github"], "GitHub")

    def test_new_format_roles(self):
        parsed = parse_resume_text(FIXTURE_NEW_FORMAT)
        roles = parsed["experience"]
        self.assertEqual(len(roles), 2)
        self.assertEqual(roles[0]["company"], "Acme Corp")
        self.assertEqual(roles[0]["company_descriptor"], "AI-Native CRM")
        self.assertEqual(roles[0]["location"], "San Francisco, CA")
        self.assertEqual(roles[0]["title"], "GTM Engineer & RevOps Lead")
        self.assertEqual(roles[0]["dates"], "2024 – Present")
        self.assertEqual(len(roles[0]["bullets"]), 2)
        # Continuation lines are merged
        self.assertIn("HubSpot via API", roles[0]["bullets"][0]["text"])

    def test_new_format_education(self):
        parsed = parse_resume_text(FIXTURE_NEW_FORMAT)
        edu = parsed["education"]
        self.assertEqual(len(edu), 1)
        self.assertEqual(edu[0]["institution"], "University of Somewhere")
        self.assertEqual(edu[0]["degree"], "Bachelor of Arts, Philosophy")
        self.assertEqual(edu[0]["dates"], "2016 – 2020")

    def test_new_format_skills(self):
        parsed = parse_resume_text(FIXTURE_NEW_FORMAT)
        skills = parsed["skills"]
        self.assertEqual(skills["Technical"], ["Python", "JavaScript", "TypeScript", "React", "Supabase"])
        self.assertEqual(skills["GTM Stack"], ["Salesforce", "HubSpot", "Clay", "Apollo"])

    def test_old_format_no_subtitle(self):
        parsed = parse_resume_text(FIXTURE_OLD_FORMAT)
        ident = parsed["identity"]
        self.assertEqual(ident["name"], "John Smith")
        self.assertEqual(ident["subtitle"], "")
        self.assertEqual(ident["location"], "New York, NY")
        self.assertEqual(ident["email"], "john@example.com")

    def test_old_format_skills_and_interests(self):
        parsed = parse_resume_text(FIXTURE_OLD_FORMAT)
        self.assertIn("Technical", parsed["skills"])

    def test_old_format_uppercase_multi_word_company_normalized(self):
        parsed = parse_resume_text(FIXTURE_OLD_FORMAT)
        roles = parsed["experience"]
        # "COMPANY ONE" → "Company One" (multi-word ALL CAPS normalizes)
        self.assertEqual(roles[0]["company"], "Company One")

    def test_empty_input_returns_empty_structure(self):
        parsed = parse_resume_text("")
        self.assertEqual(parsed["identity"]["name"], "")
        self.assertEqual(parsed["experience"], [])
        self.assertEqual(parsed["education"], [])
        self.assertEqual(parsed["skills"], {})

    def test_text_without_sections_doesnt_crash(self):
        parsed = parse_resume_text("Just some random text\nWith no sections")
        self.assertEqual(parsed["identity"]["name"], "Just some random text")
        self.assertEqual(parsed["experience"], [])


# ─── tag extraction ───────────────────────────────────────────────────────────


class ExtractBulletTagsTests(unittest.TestCase):
    def test_extracts_stack_keywords(self):
        tags = extract_bullet_tags(
            "Built a system on Supabase + Next.js with Claude API", role_slug="acme"
        )
        self.assertIn("supabase", tags)
        self.assertIn("nextjs", tags)
        self.assertIn("claude-api", tags)
        self.assertIn("technical", tags)  # "Built" verb
        self.assertIn("acme", tags)  # role tag

    def test_marks_measurable_when_metric_present(self):
        tags = extract_bullet_tags(
            "Drove +18% SQLs and 3x outbound velocity", role_slug="x"
        )
        self.assertIn("measurable", tags)

    def test_does_not_double_tag(self):
        tags = extract_bullet_tags("Built SUPABASE and supabase together", role_slug="x")
        self.assertEqual(tags.count("supabase"), 1)


class ExtractImpactMetricsTests(unittest.TestCase):
    def test_captures_percent(self):
        self.assertEqual(extract_impact_metrics("Drove +18% SQLs"), "+18%")

    def test_captures_dollar_M(self):
        self.assertEqual(extract_impact_metrics("Drove $1.8M ARR"), "$1.8M")

    def test_captures_multiplier(self):
        self.assertEqual(extract_impact_metrics("3x outbound velocity"), "3x")

    def test_does_not_capture_letter_digit_compound(self):
        # "m0x" (the project name) should not yield "0x" as a metric
        self.assertIsNone(extract_impact_metrics("Built m0x autonomous analyst"))

    def test_concatenates_multiple_metrics(self):
        result = extract_impact_metrics("Drove +18% SQLs, 3x velocity, 85% reduction")
        self.assertIsNotNone(result)
        # All three present (order is by position)
        self.assertIn("+18%", result)
        self.assertIn("3x", result)
        self.assertIn("85%", result)

    def test_dollar_amount_not_double_counted(self):
        # "$1.8M" should be captured once, not also as "$1." via secondary pattern
        result = extract_impact_metrics("$1.8M total")
        self.assertEqual(result, "$1.8M")

    def test_none_when_no_metrics(self):
        self.assertIsNone(extract_impact_metrics("Built a thing with no numbers"))


class SlugCompanyTests(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(slug_company("Linera"), "linera")

    def test_strips_descriptor(self):
        self.assertEqual(slug_company("PAYY (Private Payments)"), "payy")

    def test_handles_punctuation(self):
        self.assertEqual(slug_company("Nick Ruzicka Consulting!"), "nick-ruzicka-consulting")

    def test_empty(self):
        self.assertEqual(slug_company(""), "")


# ─── HTML emitter ─────────────────────────────────────────────────────────────


class RenderResumeHtmlTests(unittest.TestCase):
    def test_renders_archetype_attribute(self):
        parsed = parse_resume_text(FIXTURE_NEW_FORMAT)
        html_doc = render_resume_html(parsed, "gtm-engineering")
        self.assertIn('data-archetype="gtm-engineering"', html_doc)
        self.assertIn("Jane Doe", html_doc)

    def test_bullet_ids_use_archetype_prefix(self):
        parsed = parse_resume_text(FIXTURE_NEW_FORMAT)
        html_doc = render_resume_html(parsed, "gtm-engineering")
        self.assertIn('data-id="gte-001"', html_doc)
        self.assertIn('data-id="gte-002"', html_doc)

    def test_role_slug_in_data_company(self):
        parsed = parse_resume_text(FIXTURE_NEW_FORMAT)
        html_doc = render_resume_html(parsed, "gtm-engineering")
        self.assertIn('data-company="acme-corp"', html_doc)

    def test_escapes_html_special_chars(self):
        parsed = parse_resume_text(FIXTURE_NEW_FORMAT)
        html_doc = render_resume_html(parsed, "gtm-engineering")
        self.assertIn("&amp;", html_doc)  # "RevOps Lead" actually no & — but title "GTM Engineer & RevOps Lead" does
        # Make sure & itself not unescaped:
        self.assertNotIn(" & ", html_doc)


# ─── library aggregator ───────────────────────────────────────────────────────


class BuildLibraryTests(unittest.TestCase):
    def setUp(self):
        a = parse_resume_text(FIXTURE_NEW_FORMAT)
        b = parse_resume_text(FIXTURE_NEW_FORMAT)  # identical → all bullets are cross-archetype
        self.lib = build_library({"gtm-engineering": a, "ai-operations": b})

    def test_emits_archetypes_sorted(self):
        self.assertEqual(self.lib["archetypes"], ["ai-operations", "gtm-engineering"])

    def test_identical_resumes_collapse_bullets(self):
        # FIXTURE_NEW_FORMAT has 4 bullets total — with identical resumes
        # all bullets are cross-archetype singletons (one group per source bullet)
        self.assertEqual(len(self.lib["bullets"]), 4)
        for bullet in self.lib["bullets"]:
            self.assertEqual(sorted(bullet["archetypes"]), ["ai-operations", "gtm-engineering"])

    def test_bullets_have_required_fields(self):
        for bullet in self.lib["bullets"]:
            for key in ("id", "text", "archetypes", "tags", "impact_metric", "role"):
                self.assertIn(key, bullet)

    def test_current_titles_collected(self):
        # Both resumes have the same title → just one in current_titles
        self.assertEqual(len(self.lib["current_titles_at_linera"]), 1)
        self.assertEqual(
            self.lib["current_titles_at_linera"][0], "GTM Engineer & RevOps Lead"
        )

    def test_different_phrasing_groups_together(self):
        a = parse_resume_text(FIXTURE_NEW_FORMAT)
        # Synthesize a variant with a slightly different first bullet wording
        b_text = FIXTURE_NEW_FORMAT.replace(
            "Built a custom signal-routing pipeline on Supabase + Next.js that drove +18% SQLs",
            "Built a custom signal routing pipeline on Supabase and Next.js that drove +18% SQLs",
        )
        b = parse_resume_text(b_text)
        lib = build_library({"gtm-engineering": a, "ai-operations": b})
        # Expect first bullet to still be one group of two
        first_bullet_groups = [b for b in lib["bullets"] if "signal" in b["text"].lower()]
        self.assertTrue(any(len(g["archetypes"]) == 2 for g in first_bullet_groups))


if __name__ == "__main__":
    unittest.main()
