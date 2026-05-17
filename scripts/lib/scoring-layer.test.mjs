import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adjustScore,
  loadUserContext,
  clearUserContextCache,
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
