// Tests for roleFuzzyMatch — the role-title dedup used by merge-tracker.mjs
// when two rows resolve to the same normalized company.
//
// Fixtures are organized by intent:
//   1. The five adversarial cases from CHECK 3 of the upstream bug-
//      verification audit (docs/audits/2026-05-22-upstream-bug-verification.md).
//      Four must NOT match (regressions of the old behavior); one must.
//   2. Should-still-match cases — real-world same-role variants the
//      previous implementation handled, so the fix doesn't over-tighten
//      into false negatives.
//   3. Edge cases — empty/whitespace inputs, exact-string short-circuit.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { roleFuzzyMatch } from "./role-matching.mjs";

describe("roleFuzzyMatch — CHECK 3 adversarial cases (must NOT match)", () => {
  it("'ML Engineer' ≠ 'Sales Engineer' (different specialty, shared baseline 'engineer')", () => {
    assert.equal(roleFuzzyMatch("ML Engineer", "Sales Engineer"), false);
  });

  it("'Senior Software Engineer' ≠ 'Senior Software Architect' (overlap only on baseline tokens)", () => {
    assert.equal(
      roleFuzzyMatch("Senior Software Engineer", "Senior Software Architect"),
      false,
    );
  });

  it("'Staff Engineer' ≠ 'Staff Engineering Manager' (IC vs management track)", () => {
    assert.equal(
      roleFuzzyMatch("Staff Engineer", "Staff Engineering Manager"),
      false,
    );
  });

  it("'Senior Product Manager' ≠ 'Senior Product Designer' (PM vs PD on baseline overlap)", () => {
    assert.equal(
      roleFuzzyMatch("Senior Product Manager", "Senior Product Designer"),
      false,
    );
  });

  it("'Frontend Engineer' ≠ 'Frontend Engineering Manager' (IC vs management, shared specialty)", () => {
    // Asymmetric mgmt-token guard catches this even though "frontend" is a
    // shared specialty token.
    assert.equal(
      roleFuzzyMatch("Frontend Engineer", "Frontend Engineering Manager"),
      false,
    );
  });
});

describe("roleFuzzyMatch — should-still-match cases (positive controls)", () => {
  it("'Forward Deployed Engineer' ≡ 'Forward Deployed Software Engineer' (CHECK 3 positive control)", () => {
    assert.equal(
      roleFuzzyMatch(
        "Forward Deployed Engineer",
        "Forward Deployed Software Engineer",
      ),
      true,
    );
  });

  it("'Backend Engineer' ≡ 'Senior Backend Engineer' (existing merge-tracker.test.mjs case)", () => {
    // This is the positive control from the legacy merge-tracker test —
    // a re-eval of the same role at a higher seniority should dedup so
    // the higher score updates the existing row.
    assert.equal(
      roleFuzzyMatch("Backend Engineer", "Senior Backend Engineer"),
      true,
    );
  });

  it("'AI Solutions Engineer' ≡ 'Solutions Engineer, AI' (token-order + comma variant)", () => {
    assert.equal(
      roleFuzzyMatch("AI Solutions Engineer", "Solutions Engineer, AI"),
      true,
    );
  });

  it("'Senior Data Scientist' ≡ 'Data Scientist' (seniority-only delta on a real specialty)", () => {
    assert.equal(
      roleFuzzyMatch("Senior Data Scientist", "Data Scientist"),
      true,
    );
  });

  it("'ML Engineer' ≡ 'ML Engineer' (literal duplicate)", () => {
    // The exact-tokenized-match short-circuit handles this without going
    // through the specialty/overlap thresholds.
    assert.equal(roleFuzzyMatch("ML Engineer", "ML Engineer"), true);
  });

  it("'Senior GTM Engineer' ≡ 'Senior GTM Engineer (Remote)' (suffix-only variant)", () => {
    // Punctuation gets stripped by tokenize, so "(Remote)" becomes "remote".
    // Both still share senior + gtm (length 3, kept) + engineer.
    // specialty: ["gtm"] both; overlap = ["gtm"], ≥1 ✓.
    // length-≥-2 overlap: senior + gtm + engineer = 3, ≥2 ✓.
    assert.equal(
      roleFuzzyMatch("Senior GTM Engineer", "Senior GTM Engineer (Remote)"),
      true,
    );
  });
});

describe("roleFuzzyMatch — additional discriminators (must NOT match)", () => {
  it("'Data Engineer' ≠ 'Data Scientist' (same domain, different role type — overlap only on baseline)", () => {
    assert.equal(roleFuzzyMatch("Data Engineer", "Data Scientist"), false);
  });

  it("'AI Engineer' ≠ 'AI Researcher' (overlap only on AI; 'researcher' is not baseline, 'engineer' is)", () => {
    // wordsA specialty = [ai], wordsB specialty = [ai]
    // Exact specialty overlap = [ai], ≥1 ✓.
    // length-≥-2 overlap: ai + engineer ⊂ {ai, researcher}? engineer vs
    // researcher — neither substring of the other. overlap = [ai] = 1 < 2.
    // NO MATCH ✓.
    assert.equal(roleFuzzyMatch("AI Engineer", "AI Researcher"), false);
  });
});

describe("roleFuzzyMatch — edge cases", () => {
  it("empty inputs return false", () => {
    assert.equal(roleFuzzyMatch("", ""), false);
    assert.equal(roleFuzzyMatch("Engineer", ""), false);
    assert.equal(roleFuzzyMatch("", "Engineer"), false);
  });

  it("null/undefined-ish inputs do not throw", () => {
    assert.equal(roleFuzzyMatch(null, "Engineer"), false);
    assert.equal(roleFuzzyMatch("Engineer", undefined), false);
  });

  it("whitespace-only / punctuation-only inputs return false", () => {
    assert.equal(roleFuzzyMatch("   ", "Engineer"), false);
    assert.equal(roleFuzzyMatch("!!!", "???"), false);
  });

  it("exact-string short-circuit handles trailing whitespace and casing", () => {
    assert.equal(
      roleFuzzyMatch("Senior Engineer", "  senior  engineer  "),
      true,
    );
  });
});
