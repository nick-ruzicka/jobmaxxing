import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanTitle,
  titleCleanScore,
  preferCleanerTitle,
} from "./title-cleanup.mjs";

test("cleanTitle — Built In with city suffix (Airwallex)", () => {
  assert.equal(
    cleanTitle("Director GTM Engineering - Airwallex | Built In San Francisco"),
    "Director GTM Engineering - Airwallex",
  );
});

test("cleanTitle — Built In without city", () => {
  assert.equal(cleanTitle("Senior PM | Built In"), "Senior PM");
});

test("cleanTitle — LinkedIn suffix", () => {
  assert.equal(cleanTitle("Head of Revenue Operations | LinkedIn"), "Head of Revenue Operations");
});

test("cleanTitle — Wellfound suffix", () => {
  assert.equal(cleanTitle("Solutions Engineer | Wellfound"), "Solutions Engineer");
});

test("cleanTitle — Indeed suffix", () => {
  assert.equal(cleanTitle("VP Sales Engineering | Indeed"), "VP Sales Engineering");
});

test("cleanTitle — Glassdoor suffix", () => {
  assert.equal(cleanTitle("Product Marketing Lead | Glassdoor"), "Product Marketing Lead");
});

test("cleanTitle — multiple stacked suffixes peel one by one", () => {
  assert.equal(
    cleanTitle("Director GTM Eng | Built In NYC | LinkedIn"),
    "Director GTM Eng",
  );
});

test("cleanTitle — bullet (·) separator works too", () => {
  assert.equal(cleanTitle("Director GTM · Built In NYC"), "Director GTM");
});

test("cleanTitle — ' at <Company>' stripped when company matches", () => {
  assert.equal(
    cleanTitle("Backend Engineer at Stripe", { company: "Stripe" }),
    "Backend Engineer",
  );
});

test("cleanTitle — ' at <Company>' NOT stripped when company missing", () => {
  assert.equal(
    cleanTitle("Backend Engineer at Stripe"),
    "Backend Engineer at Stripe",
  );
});

test("cleanTitle — ' at <Company>' NOT stripped when company is different", () => {
  // Title says "at Stripe" but company field says "Square" — don't molest.
  assert.equal(
    cleanTitle("Backend Engineer at Stripe", { company: "Square" }),
    "Backend Engineer at Stripe",
  );
});

test("cleanTitle — ' at <Company>' case-insensitive match", () => {
  assert.equal(
    cleanTitle("Backend Engineer at STRIPE", { company: "Stripe" }),
    "Backend Engineer",
  );
});

test("cleanTitle — idempotent (clean(clean(x)) === clean(x))", () => {
  const inputs = [
    "Director GTM Engineering - Airwallex | Built In San Francisco",
    "Senior PM | Built In",
    "Head of Revenue Operations | LinkedIn",
    "Solutions Engineer | Wellfound",
    "Director GTM Eng | Built In NYC | LinkedIn",
  ];
  for (const t of inputs) {
    const once = cleanTitle(t);
    const twice = cleanTitle(cleanTitle(t));
    assert.equal(twice, once, `not idempotent: ${t}`);
  }
});

test("cleanTitle — safe on null/undefined/empty", () => {
  assert.equal(cleanTitle(null), "");
  assert.equal(cleanTitle(undefined), "");
  assert.equal(cleanTitle(""), "");
  assert.equal(cleanTitle(42), ""); // non-string input
});

test("cleanTitle — leaves untouched titles alone", () => {
  assert.equal(cleanTitle("Director of GTM Engineering"), "Director of GTM Engineering");
  assert.equal(
    cleanTitle("Senior Software Engineer - AI Platform"),
    "Senior Software Engineer - AI Platform",
  );
});

test("cleanTitle — strips trailing dash/pipe orphans after suffix removal", () => {
  assert.equal(cleanTitle("Director - Sales -"), "Director - Sales");
  assert.equal(cleanTitle("Director - | Built In NYC"), "Director");
});

test("cleanTitle — collapses internal whitespace", () => {
  assert.equal(cleanTitle("Director   of    GTM"), "Director of GTM");
});

test("cleanTitle — does NOT strip mid-string mentions of job boards", () => {
  // "LinkedIn" is the company here, not a source attribution — must be preserved.
  assert.equal(
    cleanTitle("Engineering Manager at LinkedIn", { company: "Microsoft" }),
    "Engineering Manager at LinkedIn",
  );
});

test("titleCleanScore — shorter & no-attribution titles score lower (cleaner)", () => {
  const dirty = "Director GTM Engineering - Airwallex | Built In San Francisco";
  const clean = "Director GTM Engineering - Airwallex";
  assert.ok(titleCleanScore(clean) < titleCleanScore(dirty));
});

test("preferCleanerTitle — picks the cleaner of two", () => {
  const dirty = "Director GTM Engineering - Airwallex | Built In San Francisco";
  const clean = "Director GTM Engineering - Airwallex";
  assert.equal(preferCleanerTitle(dirty, clean), clean);
  assert.equal(preferCleanerTitle(clean, dirty), clean);
});

test("preferCleanerTitle — tie-break prefers `a` (first-seen wins)", () => {
  const a = "Director GTM Engineering";
  const b = "Director GTM Engineering";
  assert.equal(preferCleanerTitle(a, b), a);
});
