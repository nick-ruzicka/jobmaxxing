// Integration test for ISSUE-002: the canonical predicate must produce the
// same role count regardless of which surface is asking, given the same
// underlying data. This is the test that would have caught the polish-1
// regressions in CI:
//
//   /signals says "1 matching role" for Mistral
//   /companies/mistralai says "0"
//   /pipeline?company=mistralai says "0 of 1262"
//
// Three views, three answers, same data. The fix is one predicate (role-
// matching.ts) consumed by all three; this test asserts consumers stay
// in agreement when the inputs vary in shape (suffix-stripped slugs,
// aggregator dupes, stale roles).

import { describe, it, expect } from "vitest";
import type { Role } from "./types";
import {
  companyCandidateKeys,
  countOpenRolesForCompany,
  getOpenRolesForCompany,
} from "./role-matching";

function role(overrides: Partial<Role> = {}): Role {
  return {
    id: "r",
    url: "https://example.com/r",
    title: "Role",
    company: "Acme",
    location: "Remote",
    location_workplace: "remote",
    location_city: null,
    location_region: null,
    location_cluster: "remote",
    source: "Tier 1: Ashby",
    source_tier: "trusted",
    score: 5,
    scoreProvenance: "heuristic",
    scoreCapped: false,
    status: "Discovered",
    firstSeen: "2026-04-09",
    publishedDate: "",
    comp: "",
    matchReason: "",
    notes: "",
    stale: false,
    closed: false,
    enrichment: null,
    ...overrides,
  } as Role;
}

describe("canonical counts agree across views", () => {
  // The original ISSUE-002 repro: seen-urls company field is "Mistral" (no
  // AI suffix), but the signal feed uses slug "mistralai". Before the fix,
  // /signals counted via fuzzy match (got 1) while /companies and /pipeline
  // counted via exact match (got 0). Three views, two answers.
  it("Mistral case: same count whether queried as 'mistral' or 'mistralai'", () => {
    const roles = [
      role({ id: "m1", company: "Mistral", title: "Solution Ops" }),
      role({ id: "o1", company: "OpenAI", title: "Eng" }),
    ];

    const fromSignals = countOpenRolesForCompany(roles, "mistralai");
    const fromCompanies = countOpenRolesForCompany(roles, "mistral");
    const fromPipeline = countOpenRolesForCompany(roles, "Mistral AI");

    expect(fromSignals).toBe(1);
    expect(fromCompanies).toBe(1);
    expect(fromPipeline).toBe(1);
  });

  // The original ISSUE-002 EliseAI repro: list said 13, drilldown said 26,
  // archetype badges summed to 16. Three different filters on the same
  // data — list excluded aggregators, drilldown included everything,
  // badges counted only enrichment-tagged roles. The canonical predicate
  // collapses the first two into one number.
  it("EliseAI case: aggregator + stale dupes don't inflate the count", () => {
    const roles = [
      role({ id: "trusted-1", company: "EliseAI", source_tier: "trusted" }),
      role({ id: "trusted-2", company: "EliseAI", source_tier: "trusted" }),
      role({ id: "trusted-stale", company: "EliseAI", source_tier: "trusted", stale: true }),
      role({ id: "trusted-rej", company: "EliseAI", status: "Rejected" }),
      role({ id: "agg-dupe-1", company: "EliseAI", source_tier: "aggregator", title: "Sara's List - GTM" }),
      role({ id: "agg-dupe-2", company: "EliseAI", source_tier: "aggregator", title: "Oak HC/FT - GTM" }),
    ];

    const count = countOpenRolesForCompany(roles, "eliseai");
    // 2 trusted-and-open; aggregator dupes hidden because trusted exists;
    // stale and Rejected excluded.
    expect(count).toBe(2);

    // Same answer whether you ask via slug form or display name.
    expect(countOpenRolesForCompany(roles, "EliseAI")).toBe(2);
    expect(countOpenRolesForCompany(roles, "Elise")).toBe(2);
  });

  it("aggregator-only company: fallback keeps the listing visible", () => {
    const roles = [
      role({ id: "agg-1", company: "SmallStartup", source_tier: "aggregator" }),
    ];
    // Better to show "1 role at SmallStartup (via aggregator)" than "0 roles."
    expect(countOpenRolesForCompany(roles, "smallstartup")).toBe(1);
  });

  it("returns the same role objects from getOpenRolesForCompany regardless of slug form", () => {
    const roles = [
      role({ id: "rillet-1", company: "Rillet", title: "GTM Ops" }),
      role({ id: "rillet-stale", company: "Rillet", stale: true, title: "GTM Eng" }),
    ];
    const asSlug = getOpenRolesForCompany(roles, "rillet");
    const asName = getOpenRolesForCompany(roles, "Rillet");
    expect(asSlug.map((r) => r.id)).toEqual(asName.map((r) => r.id));
    expect(asSlug).toHaveLength(1);
    expect(asSlug[0].id).toBe("rillet-1");
  });

  it("candidate keys stay consistent with the signals matcher's suffix list", () => {
    // FUZZY_SUFFIXES now lives in scripts/lib/company-matching.mjs (single
    // source for all runtimes). This test still pins the fuzzy-match BEHAVIOR
    // end-to-end; if it fails, check company-matching.mjs and the candidate-key
    // functions that consume it.
    expect(companyCandidateKeys("Mistral AI")).toEqual(["mistralai", "mistral"]);
    expect(companyCandidateKeys("EliseAI")).toEqual(["eliseai", "elise"]);
    expect(companyCandidateKeys("Anthropic Labs")).toContain("anthropic");
    expect(companyCandidateKeys("HirebaseIo")).toContain("hirebase");
    expect(companyCandidateKeys("CompanyHQ")).toContain("company");
    expect(companyCandidateKeys("RandoApp")).toContain("rando");
    expect(companyCandidateKeys("FooXyz")).toContain("foo");
  });
});
