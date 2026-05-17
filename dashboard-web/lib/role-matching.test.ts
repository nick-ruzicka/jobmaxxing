import { describe, expect, it } from "vitest";
import type { Role } from "./types";
import {
  companyCandidateKeys,
  isOpenRoleStatus,
  roleBelongsToCompany,
  getOpenRolesForCompany,
  countOpenRolesForCompany,
} from "./role-matching";

// Build a minimal Role with sane defaults — tests override what they care about.
function role(overrides: Partial<Role> = {}): Role {
  return {
    id: overrides.id ?? "r1",
    url: overrides.url ?? "https://example.com/r1",
    title: overrides.title ?? "GTM Engineer",
    company: overrides.company ?? "Rillet",
    location: overrides.location ?? "NYC",
    location_workplace: "remote",
    location_city: null,
    location_region: null,
    location_cluster: "remote",
    source: "Tier 1: Ashby",
    source_tier: overrides.source_tier ?? "trusted",
    score: overrides.score ?? 7,
    scoreProvenance: "heuristic",
    scoreCapped: false,
    status: overrides.status ?? "Discovered",
    firstSeen: "2026-04-09",
    publishedDate: "",
    comp: "",
    matchReason: "",
    notes: "",
    stale: overrides.stale ?? false,
    closed: overrides.closed ?? false,
    enrichment: null,
    ...overrides,
  } as Role;
}

describe("companyCandidateKeys", () => {
  it("returns the canonical key plus suffix-stripped variants", () => {
    expect(companyCandidateKeys("Mistral AI")).toEqual(["mistralai", "mistral"]);
    expect(companyCandidateKeys("mistralai")).toEqual(["mistralai", "mistral"]);
    expect(companyCandidateKeys("EliseAI")).toEqual(["eliseai", "elise"]);
  });

  it("returns just the canonical key when no suffix applies", () => {
    expect(companyCandidateKeys("Rillet")).toEqual(["rillet"]);
    expect(companyCandidateKeys("Supabase")).toEqual(["supabase"]);
  });

  it("strips multiple known suffixes but only when the stem is long enough", () => {
    // "labs" stripped, leaving "Anthropic"
    expect(companyCandidateKeys("Anthropic Labs")).toContain("anthropic");
    // "ai" suffix on a 4-char name — too short, don't strip
    expect(companyCandidateKeys("Foai")).toEqual(["foai"]);
  });

  it("dedupes when stripping produces the same string twice", () => {
    // Hypothetical: a single name passed in raw and normalized both produce
    // the same candidate list — output is still de-duped.
    const out = companyCandidateKeys("Mistral AI");
    expect(new Set(out).size).toBe(out.length);
  });

  it("returns [] for empty input", () => {
    expect(companyCandidateKeys("")).toEqual([]);
    expect(companyCandidateKeys("   ")).toEqual([]);
  });
});

describe("isOpenRoleStatus", () => {
  it("considers Discovered/Evaluated/Applied/Interview/Offer as open", () => {
    for (const status of ["Discovered", "Evaluated", "Applied", "Interview", "Offer"] as const) {
      expect(isOpenRoleStatus({ status, stale: false, closed: false })).toBe(true);
    }
  });

  it("treats Rejected and Skipped as not open", () => {
    expect(isOpenRoleStatus({ status: "Rejected", stale: false, closed: false })).toBe(false);
    expect(isOpenRoleStatus({ status: "Skipped", stale: false, closed: false })).toBe(false);
  });

  it("treats stale roles as not open regardless of status", () => {
    expect(isOpenRoleStatus({ status: "Discovered", stale: true, closed: false })).toBe(false);
  });

  it("treats closed roles as not open regardless of status", () => {
    expect(isOpenRoleStatus({ status: "Discovered", stale: false, closed: true })).toBe(false);
  });
});

describe("roleBelongsToCompany", () => {
  it("matches the exact canonical key", () => {
    expect(roleBelongsToCompany({ company: "Rillet" }, "rillet")).toBe(true);
  });

  // ISSUE-002 core repro: seen-urls stores "Mistral", signals page asks for
  // slug "mistralai". Before this predicate, the drilldown said "no roles."
  it("matches across the AI suffix gap (Mistral ↔ Mistral AI)", () => {
    expect(roleBelongsToCompany({ company: "Mistral" }, "mistralai")).toBe(true);
    expect(roleBelongsToCompany({ company: "Mistral AI" }, "mistral")).toBe(true);
  });

  it("rejects unrelated companies", () => {
    expect(roleBelongsToCompany({ company: "OpenAI" }, "mistralai")).toBe(false);
  });

  it("handles empty role.company", () => {
    expect(roleBelongsToCompany({ company: "" }, "rillet")).toBe(false);
  });
});

describe("getOpenRolesForCompany", () => {
  // ISSUE-002 Mistral case — signals says 1, aggregator/pipeline said 0.
  it("finds Mistral roles when seen-urls company is 'Mistral' and slug is 'mistralai'", () => {
    const roles = [
      role({ id: "m1", company: "Mistral", title: "Solution Ops" }),
      role({ id: "x1", company: "OpenAI", title: "Eng" }),
    ];
    expect(getOpenRolesForCompany(roles, "mistralai")).toHaveLength(1);
    expect(getOpenRolesForCompany(roles, "mistralai")[0].id).toBe("m1");
  });

  it("excludes aggregator listings when trusted listings exist", () => {
    const roles = [
      role({ id: "t1", company: "EliseAI", source_tier: "trusted" }),
      role({ id: "a1", company: "EliseAI", source_tier: "aggregator" }),
    ];
    const out = getOpenRolesForCompany(roles, "eliseai");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("t1");
  });

  // Per user clarification: better to show the aggregator listing than nothing.
  it("keeps aggregator listings when they are the only matches", () => {
    const roles = [role({ id: "a1", company: "OnlyAggCo", source_tier: "aggregator" })];
    const out = getOpenRolesForCompany(roles, "onlyaggco");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a1");
  });

  it("excludes Rejected, Skipped, stale, and closed roles", () => {
    const roles = [
      role({ id: "open", company: "Rillet", status: "Discovered" }),
      role({ id: "rej", company: "Rillet", status: "Rejected" }),
      role({ id: "skip", company: "Rillet", status: "Skipped" }),
      role({ id: "stale", company: "Rillet", status: "Discovered", stale: true }),
      role({ id: "closed", company: "Rillet", status: "Discovered", closed: true }),
    ];
    const out = getOpenRolesForCompany(roles, "rillet");
    expect(out.map((r) => r.id)).toEqual(["open"]);
  });

  it("keeps Applied/Interview/Offer roles (still considered open)", () => {
    const roles = [
      role({ id: "a", company: "Rillet", status: "Applied" }),
      role({ id: "i", company: "Rillet", status: "Interview" }),
      role({ id: "o", company: "Rillet", status: "Offer" }),
    ];
    expect(getOpenRolesForCompany(roles, "rillet")).toHaveLength(3);
  });

  it("includeAggregators:true returns aggregators even when trusted listings exist", () => {
    const roles = [
      role({ id: "t1", company: "EliseAI", source_tier: "trusted" }),
      role({ id: "a1", company: "EliseAI", source_tier: "aggregator" }),
    ];
    const out = getOpenRolesForCompany(roles, "eliseai", { includeAggregators: true });
    expect(out).toHaveLength(2);
  });

  it("returns [] for empty/whitespace slug", () => {
    const roles = [role({ company: "Rillet" })];
    expect(getOpenRolesForCompany(roles, "")).toEqual([]);
  });
});

describe("countOpenRolesForCompany", () => {
  it("matches the array length", () => {
    const roles = [
      role({ id: "a", company: "Rillet" }),
      role({ id: "b", company: "Rillet" }),
      role({ id: "c", company: "OpenAI" }),
    ];
    expect(countOpenRolesForCompany(roles, "rillet")).toBe(2);
    expect(countOpenRolesForCompany(roles, "openai")).toBe(1);
    expect(countOpenRolesForCompany(roles, "unknown")).toBe(0);
  });
});
