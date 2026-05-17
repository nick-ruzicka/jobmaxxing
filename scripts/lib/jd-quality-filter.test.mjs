import { test } from "node:test";
import assert from "node:assert/strict";

import { assessJdQuality, assessVerdictForExisting, MIN_LENGTH } from "./jd-quality-filter.mjs";

// ─── assessJdQuality (prospective gate) ───────────────────────────────────────

test("jd-quality — usable JD passes", () => {
  const result = assessJdQuality({
    title: "GTM Engineer",
    company: "Acme",
    description:
      "We are looking for a GTM Engineer to join our team. " +
      "Responsibilities include building outbound signal engines on Python + Claude API. " +
      "Qualifications: 3+ years of experience with Python and SQL. " +
      "Stack: Supabase, HubSpot, Salesforce. About the role: you'll work on signal scoring and lead routing.",
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ok");
});

test("jd-quality — short JD rejected as rejected_short", () => {
  const result = assessJdQuality({
    title: "GTM Engineer",
    description: "Build cool stuff.",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rejected_short");
});

test("jd-quality — empty input rejected", () => {
  assert.equal(assessJdQuality({}).reason, "rejected_short");
  assert.equal(assessJdQuality(null).reason, "rejected_short");
});

test("jd-quality — no section markers rejected", () => {
  const description = "X".repeat(MIN_LENGTH + 10);
  const result = assessJdQuality({
    title: "GTM Engineer",
    description,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rejected_no_section_markers");
});

test("jd-quality — course offering rejected (StackOptimise pattern)", () => {
  const result = assessJdQuality({
    title: "GTM Engineer Course",
    description:
      "Full course by StackOptimise teaching modern GTM engineering from foundations to production. " +
      "Includes lifetime access to every module plus office hours and community Slack. " +
      "Responsibilities: complete the modules in order and submit the capstone project. " +
      "Get 50% off if you enroll now during launch week. Qualifications: be eager to learn and " +
      "have basic Python familiarity to follow along with the live coding examples.",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rejected_course");
});

test("jd-quality — discount-marketing copy rejected as course", () => {
  const result = assessJdQuality({
    title: "Bootcamp",
    description:
      "Learn GTM Engineering with our hands-on bootcamp. 30% off this week only — enroll now " +
      "to lock in early-bird pricing. You'll get lifetime access to every recorded session, " +
      "weekly office hours with instructors, and access to our exclusive alumni community. " +
      "Self-paced program lets you move at your own speed. About the role: not applicable — " +
      "this is a course, not a job. Includes certification on completion.",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rejected_course");
});

test("jd-quality — press release rejected", () => {
  const result = assessJdQuality({
    title: "Acme launches GTM Engine 2026",
    description:
      "Press release: Acme is pleased to announce its latest product, the GTM Engine 2026. " +
      "Responsibilities of users: install and configure. About the launch: today we are pleased to announce. " +
      "Qualifications for users: have a HubSpot account.",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rejected_press_release");
});

test("jd-quality — real JD with 'training' as a perk still passes", () => {
  const result = assessJdQuality({
    title: "GTM Engineer",
    description:
      "We are looking for a GTM Engineer. Responsibilities include building signal engines. " +
      "Qualifications: Python, SQL. Benefits include training stipend and conference budget. " +
      "What you'll do: ship outbound infrastructure on Supabase + HubSpot + Claude API.",
  });
  assert.equal(result.ok, true);
});

test("jd-quality — course check comes before section-marker check", () => {
  // A course offering might still include "qualifications: complete prerequisites".
  // Make sure we flag it as rejected_course, not rejected_no_section_markers.
  const result = assessJdQuality({
    title: "Online Course",
    description:
      "Online course by ProTech Academy teaching modern data engineering. " +
      "Qualifications: basic Python knowledge required to enroll. " +
      "Get 50% off this month. Enroll now for lifetime access to all materials. " +
      "Responsibilities: complete weekly assignments and capstone project. " +
      "Self-paced program with mentor support and certification on completion.",
  });
  assert.equal(result.reason, "rejected_course");
});

// ─── assessVerdictForExisting (retroactive marker for existing enrichments) ──

test("verdict-retro — clean verdict returns null (no flag)", () => {
  assert.equal(
    assessVerdictForExisting("Strong alignment with GTM Engineer archetype. Real builder role."),
    null,
  );
});

test("verdict-retro — broken HTML marker → rejected_no_section_markers", () => {
  assert.equal(
    assessVerdictForExisting("This posting is completely unusable - just web metadata and schema markup"),
    "rejected_no_section_markers",
  );
});

test("verdict-retro — course training marker → rejected_course", () => {
  assert.equal(
    assessVerdictForExisting("This isn't a job posting at all - it's a course/training program offering"),
    "rejected_course",
  );
});

test("verdict-retro — blog-article marker → rejected_press_release", () => {
  assert.equal(
    assessVerdictForExisting("This is not a job posting but rather a blog article about Clay integration"),
    "rejected_press_release",
  );
});

test("verdict-retro — press release marker → rejected_press_release", () => {
  assert.equal(
    assessVerdictForExisting("This is a press release for product launch, not a job"),
    "rejected_press_release",
  );
});

test("verdict-retro — corrupted HTML → rejected_no_section_markers", () => {
  assert.equal(
    assessVerdictForExisting("Cannot evaluate - the description appears to be corrupted HTML and tracking pixels"),
    "rejected_no_section_markers",
  );
});

test("verdict-retro — empty/null input safe", () => {
  assert.equal(assessVerdictForExisting(""), null);
  assert.equal(assessVerdictForExisting(null), null);
  assert.equal(assessVerdictForExisting(undefined), null);
});
