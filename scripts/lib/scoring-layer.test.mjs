import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adjustScore,
  loadUserContext,
  clearUserContextCache,
  detectCompSourceDisagreement,
  isUS,
  ARCHETYPE_REWARD_CAP,
  SECONDARY_CAP,
} from "./scoring-layer.mjs";

clearUserContextCache();
const CTX = loadUserContext();

// ─── location ─────────────────────────────────────────────────────────────────

test("scoring-layer — hybrid NYC gets +10", () => {
  const result = adjustScore(
    7,
    { title: "Backend Engineer", company: "Acme", location_workplace: "hybrid", location_city: "New York", location_region: "NY" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.ok(loc);
  assert.equal(loc.delta, 10);
  assert.equal(loc.source, "location:hybrid_nyc");
});

test("scoring-layer — hybrid SF gets -40 (fixes over-scoring)", () => {
  const result = adjustScore(
    7,
    { title: "Backend Engineer", company: "Acme", location_workplace: "hybrid", location_city: "San Francisco", location_region: "CA" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.equal(loc.delta, -40);
  assert.equal(loc.source, "location:hybrid_sf");
});

test("scoring-layer — hybrid Brooklyn maps to hybrid_nyc_area (+8)", () => {
  const result = adjustScore(
    7,
    { title: "x", company: "y", location_workplace: "hybrid", location_city: "Brooklyn", location_region: "NY" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.equal(loc.delta, 8);
});

test("scoring-layer — onsite international maps to onsite_international", () => {
  const result = adjustScore(
    7,
    { title: "x", company: "y", location_workplace: "onsite", location_city: "London", location_region: "GB" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.equal(loc.source, "location:onsite_international");
});

// ─── isUS — California-is-Canada fix coverage ────────────────────────────────
//
// Bug history: NON_US_CODES used to contain "ca" (Canada), and isUS lowercased
// before lookup. So every California-region role (region="CA" or "ca") was
// routed to onsite_international/-75 or hybrid_international/-50 instead of
// the correct onsite_other_us/-60 or hybrid_other_us/-25 buckets. That
// silently dropped roles at OpenAI, Databricks, Skydio, Insight Partners, etc.
// to 0/10 after the May-13 locations backfill populated location_region.
//
// Fix: US_STATE_CODES (50 + DC + territories) is checked FIRST. Canadian
// province codes/names get their own buckets. The "ca" ambiguity defaults to
// California (US) unless a known Canadian city overrides it.

test("isUS — 'CA' (uppercase) is California (US)", () => {
  assert.equal(isUS("CA"), true);
});

test("isUS — 'ca' (lowercase) is California (US)", () => {
  assert.equal(isUS("ca"), true);
});

test("isUS — 'California' (full name) is US", () => {
  assert.equal(isUS("California"), true);
});

test("isUS — 'NY' is US (sanity check — no regression on other state codes)", () => {
  assert.equal(isUS("NY"), true);
});

test("isUS — region 'Canada' with city Toronto is non-US", () => {
  assert.equal(isUS("Canada", "Toronto"), false);
});

test("isUS — region 'Canada' with city Montreal is non-US", () => {
  assert.equal(isUS("Canada", "Montreal"), false);
});

test("isUS — 'Ontario' (province full name) is non-US", () => {
  assert.equal(isUS("Ontario"), false);
});

test("isUS — 'BC' (province code) is non-US", () => {
  assert.equal(isUS("BC"), false);
});

// Additional defensive cases around the disambiguation logic

test("isUS — 'ca' + Canadian city (Toronto) → non-US (city overrides ambiguous region)", () => {
  assert.equal(isUS("ca", "toronto"), false);
});

test("isUS — 'ca' + non-Canadian city (San Jose) → US (default California)", () => {
  assert.equal(isUS("ca", "San Jose"), true);
});

test("isUS — 'ca' with no city → US (default California, no Canadian signal)", () => {
  assert.equal(isUS("ca"), true);
});

test("isUS — other previously-conflicting state codes resolve to US (DE/IL/AR/CO/IN)", () => {
  // These were all in the old NON_US_CODES (DE=Germany, IL=Israel, AR=Argentina,
  // CO=Colombia, IN=India). The fix moves them out and into US_STATE_CODES.
  assert.equal(isUS("DE"), true, "Delaware not Germany");
  assert.equal(isUS("IL"), true, "Illinois not Israel");
  assert.equal(isUS("AR"), true, "Arkansas not Argentina");
  assert.equal(isUS("CO"), true, "Colorado not Colombia");
  assert.equal(isUS("IN"), true, "Indiana not India");
});

test("isUS — unambiguous non-US country codes stay non-US (GB, FR, DE→wait DE is now US)", () => {
  assert.equal(isUS("GB"), false);
  assert.equal(isUS("FR"), false);
  assert.equal(isUS("JP"), false);
  assert.equal(isUS("MX"), false);
});

test("isUS — explicit country names: 'US', 'USA', 'United States' → US", () => {
  assert.equal(isUS("US"), true);
  assert.equal(isUS("USA"), true);
  assert.equal(isUS("united states"), true);
});

test("isUS — empty/null/undefined → false (defensive)", () => {
  assert.equal(isUS(""), false);
  assert.equal(isUS(null), false);
  assert.equal(isUS(undefined), false);
});

test("isUS — Canadian province codes: QC, AB, NS, etc.", () => {
  assert.equal(isUS("QC"), false, "Quebec");
  assert.equal(isUS("AB"), false, "Alberta");
  assert.equal(isUS("NS"), false, "Nova Scotia");
  assert.equal(isUS("NU"), false, "Nunavut");
});

test("isUS — Canadian province full names: 'Quebec', 'British Columbia', 'Alberta'", () => {
  assert.equal(isUS("Quebec"), false);
  assert.equal(isUS("British Columbia"), false);
  assert.equal(isUS("Alberta"), false);
});

// ─── locationAdjustment — integration: California roles get the correct bucket ─

test("location — onsite San Jose, CA → onsite_other_us (was onsite_international before fix)", () => {
  const result = adjustScore(
    7,
    { title: "x", company: "y", location_workplace: "onsite", location_city: "San Jose", location_region: "CA" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.ok(loc, "expected a location adjustment");
  assert.equal(loc.source, "location:onsite_other_us");
});

test("location — hybrid Sacramento, CA → hybrid_other_us (was hybrid_international before fix)", () => {
  const result = adjustScore(
    7,
    { title: "x", company: "y", location_workplace: "hybrid", location_city: "Sacramento", location_region: "CA" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.equal(loc.source, "location:hybrid_other_us");
});

test("location — onsite Toronto, Canada → onsite_international (Canadian city + region)", () => {
  const result = adjustScore(
    7,
    { title: "x", company: "y", location_workplace: "onsite", location_city: "Toronto", location_region: "Canada" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.equal(loc.source, "location:onsite_international");
});

test("location — onsite Vancouver, BC → onsite_international (province code)", () => {
  const result = adjustScore(
    7,
    { title: "x", company: "y", location_workplace: "onsite", location_city: "Vancouver", location_region: "BC" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.equal(loc.source, "location:onsite_international");
});

test("location — onsite Toronto with region 'ca' (ambiguous, city disambiguates) → onsite_international", () => {
  // This is the disambiguation test: region 'ca' could be California OR Canada;
  // city 'Toronto' makes it unambiguously Canadian.
  const result = adjustScore(
    7,
    { title: "x", company: "y", location_workplace: "onsite", location_city: "Toronto", location_region: "ca" },
    null,
  );
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.equal(loc.source, "location:onsite_international");
});

// ─── compensation ─────────────────────────────────────────────────────────────

test("scoring-layer — comp $150K listed → below floor penalty -50", () => {
  const result = adjustScore(
    8,
    { title: "x", company: "y", comp_range: "$150,000 - $180,000" },
    null,
  );
  const comp = result.adjustments.find((a) => a.source.startsWith("comp:"));
  assert.equal(comp.delta, -50);
  assert.equal(comp.source, "comp:below_floor");
});

test("scoring-layer — comp $220K listed → no penalty", () => {
  const result = adjustScore(
    8,
    { title: "x", company: "y", comp_range: "$220K - $250K" },
    null,
  );
  const comp = result.adjustments.find((a) => a.source.startsWith("comp:below_floor"));
  assert.equal(comp, undefined);
});

test("scoring-layer — comp 'Not listed' → -5 penalty", () => {
  const result = adjustScore(
    8,
    { title: "x", company: "y", comp_range: "Not listed" },
    null,
  );
  const comp = result.adjustments.find((a) => a.source === "comp:not_listed");
  assert.equal(comp.delta, -5);
});

// ─── comp trust gate (Phase 1) ────────────────────────────────────────────────
// When comp_source is jsonld_basesalary (known-unreliable per Fix #5) AND Claude's
// own enrichment (verdict or red_flags) contradicts the scraped band by reporting
// "no comp listed", treat the scraped band as unverified and suppress the
// comp:below_floor penalty. Emit comp:below_floor_suppressed (delta 0) so the
// disagreement is visible in /scan audit trails.

test("scoring-layer — jsonld_basesalary + Claude says 'no comp mentioned' → penalty suppressed, tag emitted", () => {
  const result = adjustScore(
    8,
    {
      title: "x",
      company: "y",
      comp_range: "$101,500 – $135,000 /yr",
      comp_source: "jsonld_basesalary",
      verdict: "Excellent fit. However, no comp listed is concerning given the $200K floor.",
      red_flags: ["No compensation mentioned"],
    },
    null,
  );
  const penalty = result.adjustments.find((a) => a.source === "comp:below_floor");
  const suppressed = result.adjustments.find((a) => a.source === "comp:below_floor_suppressed");
  assert.equal(penalty, undefined, "below_floor penalty should be suppressed when Claude contradicts");
  assert.ok(suppressed, "comp:below_floor_suppressed tag should be emitted");
  assert.equal(suppressed.delta, 0);
  assert.ok(/jsonld_basesalary/i.test(suppressed.reason));
});

test("scoring-layer — jsonld_basesalary + Claude confirms band → penalty applies as before", () => {
  // Claude acknowledges the comp in prose and red-flags it as below floor — no contradiction.
  const result = adjustScore(
    8,
    {
      title: "x",
      company: "y",
      comp_range: "$101,500 – $135,000 /yr",
      comp_source: "jsonld_basesalary",
      verdict: "Comp listed at $101,500-$135,000 is well below your $200K floor; expect to negotiate hard.",
      red_flags: ["Compensation range below $200K floor"],
    },
    null,
  );
  const penalty = result.adjustments.find((a) => a.source === "comp:below_floor");
  const suppressed = result.adjustments.find((a) => a.source === "comp:below_floor_suppressed");
  assert.ok(penalty, "below_floor penalty should apply when Claude confirms the band");
  assert.equal(penalty.delta, -50);
  assert.equal(suppressed, undefined);
});

test("scoring-layer — non-jsonld_basesalary source applies penalty regardless of Claude text", () => {
  // Gate is source-gated. Even when Claude says "no comp listed", a non-JSON-LD source
  // does NOT trigger suppression — only the known-unreliable JSON-LD scrape path does.
  const result = adjustScore(
    8,
    {
      title: "x",
      company: "y",
      comp_range: "$101,500 – $135,000 /yr",
      comp_source: "jd_prose",
      verdict: "No comp listed in the JD.",
      red_flags: ["No compensation mentioned"],
    },
    null,
  );
  const penalty = result.adjustments.find((a) => a.source === "comp:below_floor");
  const suppressed = result.adjustments.find((a) => a.source === "comp:below_floor_suppressed");
  assert.ok(penalty, "below_floor penalty should apply on non-jsonld_basesalary sources");
  assert.equal(suppressed, undefined);
});

test("scoring-layer — Anaconda's actual record shape → suppressed", () => {
  // From data/enrichments.json @ https://builtin.com/job/gtm-engineer/8843434
  // This is the role surfaced by the 2026-05-17 audit: fit_score 8, dropped to
  // adjusted 6 by a -50 penalty on a JSON-LD band Claude flagged as missing.
  const result = adjustScore(
    8,
    {
      title: "GTM Engineer",
      company: "Anaconda",
      comp_range: "$101,500 – $135,000 /yr",
      comp_source: "jsonld_basesalary",
      location_workplace: "remote",
      verdict:
        "This is an excellent match - the JD reads like it was written for this candidate's exact skill set. " +
        "The role emphasizes building AI-powered GTM systems using Clay/n8n/Zapier, which directly aligns with " +
        "the Linera and Chariot Signal Engines. However, Anaconda being a large established company may mean " +
        "slower GTM execution and bureaucracy, plus no comp listed is concerning given the $200K floor requirement.",
      red_flags: [
        "5-7 years experience requirement when candidate has clear track record",
        "Bachelor's degree requirement",
        "No compensation mentioned",
        "Anaconda is established/large company potentially with slower GTM",
      ],
    },
    "gtm-engineering",
  );
  const penalty = result.adjustments.find((a) => a.source === "comp:below_floor");
  const suppressed = result.adjustments.find((a) => a.source === "comp:below_floor_suppressed");
  assert.equal(penalty, undefined, "Anaconda should NOT have below_floor penalty after trust gate");
  assert.ok(suppressed, "Anaconda should have comp:below_floor_suppressed tag");
});

test("detectCompSourceDisagreement — pure function semantics", () => {
  // Source matches + verdict contradicts → disagrees
  const r1 = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    verdict: "Strong fit but no comp listed.",
    red_flags: [],
  });
  assert.equal(r1.disagrees, true);
  assert.ok(r1.reason, "reason should explain the contradiction");

  // Source matches + Claude confirms → does NOT disagree
  const r2 = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    verdict: "Salary is $150K-$180K which is below your floor.",
    red_flags: ["Below floor"],
  });
  assert.equal(r2.disagrees, false);

  // Source does NOT match (gate is source-gated) → never disagrees
  const r3 = detectCompSourceDisagreement({
    comp_source: "jd_prose",
    verdict: "no comp listed",
    red_flags: ["No compensation mentioned"],
  });
  assert.equal(r3.disagrees, false, "gate must be source-gated");

  // Source matches + only red_flags channel triggers → disagrees
  const r4 = detectCompSourceDisagreement({
    comp_source: "jsonld_basesalary",
    verdict: "",
    red_flags: ["No compensation mentioned"],
  });
  assert.equal(r4.disagrees, true);

  // Missing fields → does NOT disagree (safe default)
  const r5 = detectCompSourceDisagreement({});
  assert.equal(r5.disagrees, false);
});

// ─── archetype lens ───────────────────────────────────────────────────────────

test("scoring-layer — gtm-engineering archetype boosts a matching JD", () => {
  const result = adjustScore(
    7,
    {
      title: "GTM Engineer",
      company: "Acme",
      description: "Build outbound signal engines on Python + HubSpot + Claude API. RevOps engineering for a Series B AI-native company.",
    },
    "gtm-engineering",
  );
  const arch = result.adjustments.find((a) => a.source.startsWith("archetype:gtm-engineering"));
  assert.ok(arch);
  assert.ok(arch.delta > 0);
  assert.ok(arch.delta <= ARCHETYPE_REWARD_CAP, `archetype delta ${arch.delta} exceeded cap ${ARCHETYPE_REWARD_CAP}`);
});

test("scoring-layer — institutional Web3 (Turnkey) BD role gets tier_1 boost", () => {
  const result = adjustScore(
    7,
    {
      title: "Head of Business Development",
      company: "Turnkey",
      description: "Drive enterprise BD with institutional partners. Strategic partnerships at scale.",
    },
    "web3-bd",
  );
  const arch = result.adjustments.find((a) => a.source.startsWith("archetype:web3-bd"));
  assert.ok(arch);
  assert.ok(arch.delta >= 15, `expected strong boost, got ${arch.delta}`);
});

test("scoring-layer — multi-archetype caps secondary at 0.5x", () => {
  const r1 = adjustScore(
    7,
    { title: "GTM Engineer", company: "Acme", description: "Build outbound signal engines on Python + HubSpot + Claude API. Customer-facing engineering. RevOps." },
    "gtm-engineering",
    [],
  );
  const r2 = adjustScore(
    7,
    { title: "GTM Engineer", company: "Acme", description: "Build outbound signal engines on Python + HubSpot + Claude API. Customer-facing engineering. RevOps." },
    "gtm-engineering",
    ["fde"],
  );
  const archP_only = r1.adjustments.find((a) => a.source.startsWith("archetype:gtm-engineering"));
  const archP_multi = r2.adjustments.find((a) => a.source === "archetype:gtm-engineering");
  const archS = r2.adjustments.find((a) => a.source === "archetype:fde:secondary");
  assert.equal(archP_only.delta, archP_multi.delta); // primary unchanged
  assert.ok(archS, "expected secondary archetype adjustment");
  // Secondary delta should be ~0.5x what a primary fde would give for this JD
  const rFdePrim = adjustScore(
    7,
    { title: "GTM Engineer", company: "Acme", description: "Build outbound signal engines on Python + HubSpot + Claude API. Customer-facing engineering. RevOps." },
    "fde",
  );
  const archFdePrimary = rFdePrim.adjustments.find((a) => a.source === "archetype:fde");
  if (archFdePrimary) {
    assert.ok(
      archS.delta <= Math.round(archFdePrimary.delta * SECONDARY_CAP) + 1,
      `secondary delta ${archS.delta} exceeded ${SECONDARY_CAP}x primary ${archFdePrimary.delta}`,
    );
  }
});

// ─── disqualifiers ────────────────────────────────────────────────────────────

test("scoring-layer — gambling industry hard_no disqualifies", () => {
  const result = adjustScore(
    8,
    { title: "Engineer", company: "BetCo", description: "Build the gambling platform...", industry: "gambling" },
    "gtm-engineering",
  );
  assert.equal(result.disqualified, true);
  assert.equal(result.adjusted_score, 0);
  assert.ok(result.disqualification_reason.includes("gambling"));
});

// ─── single-adjustment delta surprise check ───────────────────────────────────

test("scoring-layer — no single adjustment exceeds ±75 in magnitude (sanity)", () => {
  // The surprise rule: STOP if any single adjustment source delta >75.
  // This test guards the config values against accidental escalation.
  const samples = [
    { workplace: "remote" },
    { workplace: "hybrid", city: "New York" },
    { workplace: "hybrid", city: "San Francisco" },
    { workplace: "hybrid", city: "London", region: "GB" },
    { workplace: "onsite", city: "Berlin", region: "DE" },
  ];
  for (const s of samples) {
    const result = adjustScore(
      7,
      {
        title: "Engineer",
        company: "Acme",
        location_workplace: s.workplace,
        location_city: s.city,
        location_region: s.region,
        comp_range: "$50,000",
      },
      "gtm-engineering",
    );
    for (const a of result.adjustments) {
      assert.ok(
        Math.abs(a.delta) <= 75,
        `single adjustment ${a.source} exceeded 75 magnitude: ${a.delta}`,
      );
    }
  }
});

// ─── soft preferences ─────────────────────────────────────────────────────────

test("scoring-layer — a16z-backed mention adds soft_preferences boost", () => {
  const result = adjustScore(
    7,
    {
      title: "Engineer",
      company: "Linera (a16z-backed Layer 1)",
      description: "Backed by a16z. AI-native systems for revenue.",
    },
    "gtm-engineering",
  );
  const soft = result.adjustments.find((a) => a.source === "soft:a16z_portfolio");
  assert.ok(soft, "expected a16z soft preference");
  assert.equal(soft.delta, 5);
});

// ─── base + delta math ────────────────────────────────────────────────────────

test("scoring-layer — adjusted_score is clamped to [0, 10]", () => {
  // Base 9, plus +30 archetype, plus +10 hybrid_nyc, plus +5 a16z. Total = 9 + 4.5 = 13.5 → clamp 10.
  const result = adjustScore(
    9,
    {
      title: "GTM Engineer",
      company: "Linera (a16z-backed)",
      description: "Built on Supabase + Next.js + Claude API. Outbound + signal + HubSpot. a16z portfolio company. Series A AI-native.",
      location_workplace: "hybrid",
      location_city: "New York",
      location_region: "NY",
    },
    "gtm-engineering",
  );
  assert.ok(result.adjusted_score <= 10);
});

test("scoring-layer — null primary archetype is handled gracefully (no archetype lens)", () => {
  // When classifier returns primary=null (no-match), scoring still applies
  // location / comp / etc. — just no archetype-lens contribution.
  const result = adjustScore(
    7,
    {
      title: "Office Manager",
      company: "WeWork",
      location_workplace: "hybrid",
      location_city: "New York",
      location_region: "NY",
    },
    null, // ← null primary
    [],   // ← empty secondary
  );
  assert.equal(result.disqualified, false);
  // Location bump still applies
  const loc = result.adjustments.find((a) => a.source.startsWith("location:"));
  assert.ok(loc);
  // No archetype adjustment present
  const arch = result.adjustments.find((a) => a.source.startsWith("archetype:"));
  assert.equal(arch, undefined);
});

// ─── comp unverified ceiling cap (Phase 1.5) ────────────────────────────────
// When comp:below_floor_suppressed is in the adjustments trail, a perfect 10
// is structurally dishonest — the comp could still be below floor. Cap at 8.5.

test("ceiling cap — Anaconda-shaped: base 8 + remote + suppressed + archetype → capped to 8.5", () => {
  // base 8 → internal 80, +5 remote, +0 suppressed, +25 archetype cap = 110 → clamp 100 → 10.0 → cap 8.5
  const result = adjustScore(
    8,
    {
      title: "GTM Engineer",
      company: "Anaconda",
      comp_range: "$101,500 – $135,000 /yr",
      comp_source: "jsonld_basesalary",
      location_workplace: "remote",
      verdict: "Excellent fit but no comp listed is concerning.",
      red_flags: ["No compensation mentioned"],
      description: "Build outbound signal engines on Python + HubSpot + Claude API. RevOps engineering.",
    },
    "gtm-engineering",
  );
  assert.equal(result.adjusted_score, 8.5, "should be capped at 8.5");
  const suppressed = result.adjustments.find(a => a.source === "comp:below_floor_suppressed");
  const cap = result.adjustments.find(a => a.source === "ceiling:comp_unverified_cap");
  assert.ok(suppressed, "comp:below_floor_suppressed should be present");
  assert.ok(cap, "ceiling:comp_unverified_cap should be present");
  assert.equal(cap.delta, 0);
});

test("ceiling cap — does NOT fire when comp_unverified is absent", () => {
  // base 8 → internal 80, +5 remote, +25 archetype = 110 → clamp 100 → 10.0 (no suppression → no cap)
  const result = adjustScore(
    8,
    {
      title: "GTM Engineer",
      company: "Acme",
      location_workplace: "remote",
      description: "Build outbound signal engines on Python + HubSpot + Claude API. RevOps engineering.",
    },
    "gtm-engineering",
  );
  assert.equal(result.adjusted_score, 10.0, "should NOT be capped without comp:below_floor_suppressed");
  const cap = result.adjustments.find(a => a.source === "ceiling:comp_unverified_cap");
  assert.equal(cap, undefined, "ceiling cap should not be in adjustments");
});

test("ceiling cap — does NOT fire when score is already below 8.5", () => {
  // base 4 → internal 40, +10 hybrid_nyc, +0 suppressed, +13 secondary archetype = 63 → 6.3 (below 8.5)
  const result = adjustScore(
    4,
    {
      title: "GTM Engineer",
      company: "Acme",
      comp_range: "$101,500 – $135,000 /yr",
      comp_source: "jsonld_basesalary",
      location_workplace: "hybrid",
      location_city: "New York",
      location_region: "NY",
      verdict: "No comp listed.",
      red_flags: ["No compensation mentioned"],
      description: "Customer-facing engineering. RevOps.",
    },
    null,
    ["gtm-engineering"],
  );
  assert.ok(result.adjusted_score <= 8.5, "score should already be below 8.5");
  const cap = result.adjustments.find(a => a.source === "ceiling:comp_unverified_cap");
  assert.equal(cap, undefined, "ceiling cap should NOT fire when score is below 8.5");
});

test("ceiling cap — does NOT fire at exactly 8.5 boundary", () => {
  // Need uncapped score of exactly 8.5: internal 85 after clamp → 8.5
  // base 8 → 80, +5 remote, +0 suppressed = 85 → 8.5 (condition is > 8.5, not >=)
  const result = adjustScore(
    8,
    {
      title: "Office Manager",
      company: "Acme",
      comp_range: "$101,500 – $135,000 /yr",
      comp_source: "jsonld_basesalary",
      location_workplace: "remote",
      verdict: "No comp listed.",
      red_flags: ["No compensation mentioned"],
      description: "Manage office operations.",
    },
    null, // no archetype → no archetype boost
  );
  assert.equal(result.adjusted_score, 8.5, "score should be exactly 8.5");
  const cap = result.adjustments.find(a => a.source === "ceiling:comp_unverified_cap");
  assert.equal(cap, undefined, "ceiling cap should NOT fire at exactly 8.5 (only > 8.5)");
});

test("ceiling cap — fires at 9.0, caps to 8.5", () => {
  // base 9 → 90, +5 remote, +0 suppressed = 95 → 9.5 → cap to 8.5
  const result = adjustScore(
    9,
    {
      title: "Office Manager",
      company: "Acme",
      comp_range: "$101,500 – $135,000 /yr",
      comp_source: "jsonld_basesalary",
      location_workplace: "remote",
      verdict: "No comp listed.",
      red_flags: ["No compensation mentioned"],
      description: "Manage office operations.",
    },
    null,
  );
  assert.equal(result.adjusted_score, 8.5, "should be capped at 8.5");
  const cap = result.adjustments.find(a => a.source === "ceiling:comp_unverified_cap");
  assert.ok(cap, "ceiling:comp_unverified_cap should be present");
  assert.equal(cap.delta, 0);
});

test("scoring-layer — adjusted_score is clamped to >= 0", () => {
  // Base 1, with heavy onsite + comp penalty
  const result = adjustScore(
    1,
    {
      title: "x",
      company: "y",
      location_workplace: "onsite",
      location_city: "Tokyo",
      location_region: "JP",
      comp_range: "$50,000",
    },
    null,
  );
  assert.ok(result.adjusted_score >= 0);
});
