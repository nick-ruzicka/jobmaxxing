// company-aggregator.test.mjs — tests for the per-company aggregation library.
//
// All tests inject fixture data via the opts second-arg so we never touch the
// real data/* files. The aggregator is pure given (seenUrls, enrichments,
// signals, watchlist) — driven entirely by injection.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aggregateCompany, aggregateAllCompanies } from "./company-aggregator.mjs";

// ---------------------------------------------------------------------------
// Fixtures — small, deliberate, cover the edge cases the spec calls out.
// ---------------------------------------------------------------------------

const SEEN = {
  "https://j.com/acme/r1": {
    firstSeen: "2026-04-01",
    title: "GTM Engineer",
    company: "Acme AI",
    source: "Tier 1: Ashby",
  },
  "https://j.com/acme/r2": {
    firstSeen: "2026-05-10",
    title: "AI Ops Lead",
    company: "Acme AI",
    source: "Tier 1: Ashby",
  },
  "https://j.com/acme/r3": {
    firstSeen: "2026-04-15",
    title: "Sales Engineer",
    company: "Acme AI",
    source: "Tier 1: Ashby",
  },
  "https://j.com/beta/r1": {
    firstSeen: "2026-04-20",
    title: "Software Engineer",
    // No legal-suffix tail — normalize-company strips " Corp"/" Inc" etc. and
    // would land us at companyKey("beta") instead of the expected key.
    company: "Betatech",
    source: "Tier 2: Greenhouse",
  },
};

const ENRICH = {
  "https://j.com/acme/r1": {
    archetype_primary: "gtm-engineering",
    score_base: 7,
    score_adjusted: 8,
    green_flags: ["AI-native company", "Series B stage", "Ownership emphasized"],
    red_flags: ["No remote option"],
    team_context: "Founding role, building from zero",
    company_stage: "Series B",
    build_component: true,
    ai_signal: true,
    fit_score: 7,
  },
  "https://j.com/acme/r2": {
    archetype_primary: "ai-operations",
    score_base: 6,
    score_adjusted: 7,
    green_flags: ["AI-native company", "Remote-friendly"],
    red_flags: ["No comp listed", "No remote option"],
    team_context: "Joining established team of 10",
    company_stage: "Series B",
    build_component: false,
    ai_signal: true,
    fit_score: 6,
  },
  // r3 unclassified — no archetype_primary, no enrichment payload to speak of.
};

const SIGNALS = [
  {
    slug: "acmeai",
    name: "Acme AI",
    amount: "$50M",
    lastChecked: "2026-05-12",
    result: "high",
  },
  {
    slug: "lonelysignal",
    name: "Lonely Signal Co",
    amount: "$10M",
    lastChecked: "2026-05-05",
    result: "monitor",
  },
];

const WATCHLIST = [
  { canonical_name: "Acme AI", ats: "ashby", slug: "acme-ai" },
];

const FIXTURES = { seenUrls: SEEN, enrichments: ENRICH, signals: SIGNALS, watchlist: WATCHLIST };

// ---------------------------------------------------------------------------
// aggregateCompany
// ---------------------------------------------------------------------------

describe("aggregateCompany — identity", () => {
  it("returns null for unknown slug", () => {
    assert.equal(aggregateCompany("doesnotexist", FIXTURES), null);
  });

  it("populates identity from the signal entry when present", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    assert.equal(agg.identity.name, "Acme AI");
    assert.equal(agg.identity.slug, "acmeai");
    assert.equal(agg.identity.funding_amount, "$50M");
    assert.equal(agg.identity.funding_date, "2026-05-12");
    assert.equal(agg.identity.ats, "ashby");
  });

  it("falls back to seenUrls company name when no signal is present", () => {
    const agg = aggregateCompany("betatech", FIXTURES);
    assert.equal(agg.identity.name, "Betatech");
    assert.equal(agg.identity.funding_amount, null);
    assert.equal(agg.identity.ats, null);
  });

  it("returns identity for signal-only companies (no roles)", () => {
    const agg = aggregateCompany("lonelysignal", FIXTURES);
    assert.equal(agg.identity.name, "Lonely Signal Co");
    assert.equal(agg.identity.funding_amount, "$10M");
    assert.equal(agg.roles.length, 0);
  });

  it("returns null employee_count (we don't track it today)", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    assert.equal(agg.identity.employee_count, null);
  });
});

describe("aggregateCompany — roles", () => {
  it("collects every role for the company with id/title/scores/link", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    assert.equal(agg.roles.length, 3);
    const titles = agg.roles.map((r) => r.title).sort();
    assert.deepEqual(titles, ["AI Ops Lead", "GTM Engineer", "Sales Engineer"]);
    const r1 = agg.roles.find((r) => r.title === "GTM Engineer");
    assert.equal(r1.archetype_primary, "gtm-engineering");
    assert.equal(r1.score_base, 7);
    assert.equal(r1.score_adjusted, 8);
    assert.equal(r1.link, "https://j.com/acme/r1");
    assert.ok(r1.id, "role id is populated");
  });

  it("nulls archetype_primary on unclassified roles instead of dropping them", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    const r3 = agg.roles.find((r) => r.title === "Sales Engineer");
    assert.equal(r3.archetype_primary, null);
    assert.equal(r3.score_adjusted, null);
  });
});

describe("aggregateCompany — enrichment_summary", () => {
  it("ranks green_flags by count, top 5", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    const gf = agg.enrichment_summary.green_flags;
    assert.ok(gf.length <= 5);
    assert.equal(gf[0].flag, "AI-native company");
    assert.equal(gf[0].count, 2);
    // The 1-count items appear after; order among ties is by first-seen alpha,
    // but we only need them present, not strictly ordered.
    const flags = gf.map((f) => f.flag);
    assert.ok(flags.includes("Series B stage"));
    assert.ok(flags.includes("Ownership emphasized"));
    assert.ok(flags.includes("Remote-friendly"));
  });

  it("ranks red_flags by count, top 5", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    const rf = agg.enrichment_summary.red_flags;
    assert.equal(rf[0].flag, "No remote option");
    assert.equal(rf[0].count, 2);
    assert.ok(rf.find((f) => f.flag === "No comp listed"));
  });

  it("deduplicates team_context themes, sorted by frequency", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    const tc = agg.enrichment_summary.team_context;
    assert.equal(tc.length, 2);
    assert.ok(tc.find((t) => t.theme === "Founding role, building from zero"));
    assert.ok(tc.find((t) => t.theme === "Joining established team of 10"));
  });

  it("computes company_stage mode + count", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    assert.deepEqual(agg.enrichment_summary.company_stage, { mode: "Series B", count: 2 });
  });

  it("returns null company_stage mode when no enrichment has it", () => {
    const agg = aggregateCompany("betatech", FIXTURES);
    assert.equal(agg.enrichment_summary.company_stage, null);
  });

  it("counts distinct build_component values", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    const bc = agg.enrichment_summary.build_component;
    const t = bc.find((b) => b.value === true);
    const f = bc.find((b) => b.value === false);
    assert.equal(t.count, 1);
    assert.equal(f.count, 1);
  });

  it("counts distinct ai_signal values", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    const ai = agg.enrichment_summary.ai_signal;
    assert.equal(ai.length, 1);
    assert.deepEqual(ai[0], { value: true, count: 2 });
  });
});

describe("aggregateCompany — archetype_distribution", () => {
  it("counts roles by archetype_primary, omitting unclassified", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    assert.deepEqual(agg.archetype_distribution, {
      "gtm-engineering": 1,
      "ai-operations": 1,
    });
  });

  it("returns empty distribution for companies with no enrichment", () => {
    const agg = aggregateCompany("betatech", FIXTURES);
    assert.deepEqual(agg.archetype_distribution, {});
  });
});

describe("aggregateCompany — last_role_seen_date", () => {
  it("returns the max firstSeen across the company's roles", () => {
    const agg = aggregateCompany("acmeai", FIXTURES);
    assert.equal(agg.last_role_seen_date, "2026-05-10");
  });

  it("returns null when the company has no roles", () => {
    const agg = aggregateCompany("lonelysignal", FIXTURES);
    assert.equal(agg.last_role_seen_date, null);
  });
});

describe("aggregateCompany — hiring_velocity", () => {
  it("derives velocity from archetype-matched role count", () => {
    // acmeai has 2 archetype-matched roles → "warming" (threshold: warming=1, hot=3).
    const agg = aggregateCompany("acmeai", FIXTURES);
    assert.equal(agg.hiring_velocity, "warming");
  });

  it("returns 'cold' for companies with no archetype roles", () => {
    const agg = aggregateCompany("betatech", FIXTURES);
    assert.equal(agg.hiring_velocity, "cold");
  });
});

// ---------------------------------------------------------------------------
// aggregateAllCompanies
// ---------------------------------------------------------------------------

describe("aggregateCompany — disk-loader path", () => {
  it("does not throw when called without an injected watchlist (uses the real loader)", () => {
    // Regression for the original `watchlist is not iterable` bug —
    // readCompaniesFile() returns { entries, path } and the aggregator must
    // unwrap to the entries array. We can't easily assert disk content here,
    // but verifying the no-throw path is enough to catch the type mismatch.
    const opts = {
      seenUrls: SEEN,
      enrichments: ENRICH,
      signals: SIGNALS,
      // watchlist intentionally omitted — forces loadWatchlist() path
    };
    // Either a known fixture company or null is acceptable; the assertion is
    // that the call doesn't throw.
    assert.doesNotThrow(() => aggregateCompany("acmeai", opts));
  });
});

describe("aggregateAllCompanies", () => {
  it("returns one entry per distinct company (roles ∪ signals)", () => {
    const all = aggregateAllCompanies(FIXTURES);
    const slugs = [...all.keys()].sort();
    assert.deepEqual(slugs, ["acmeai", "betatech", "lonelysignal"]);
  });

  it("entries are full aggregate objects", () => {
    const all = aggregateAllCompanies(FIXTURES);
    const acme = all.get("acmeai");
    assert.equal(acme.identity.name, "Acme AI");
    assert.equal(acme.roles.length, 3);
    assert.equal(acme.hiring_velocity, "warming");
  });

  it("includes signal-only companies with empty roles array", () => {
    const all = aggregateAllCompanies(FIXTURES);
    const lonely = all.get("lonelysignal");
    assert.equal(lonely.identity.funding_amount, "$10M");
    assert.equal(lonely.roles.length, 0);
  });
});
