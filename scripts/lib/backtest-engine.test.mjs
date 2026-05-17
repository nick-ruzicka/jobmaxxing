import { test } from "node:test";
import assert from "node:assert/strict";

import { runBacktest } from "./backtest-engine.mjs";

// Synthetic enrichments and seen-urls for deterministic tests
const enrichments = {
  "r1": {
    archetype_primary: "gtm-engineering",
    archetype_secondary: [],
    fit_score: 8,
    timestamp: "2026-05-15T10:00:00Z",
    verdict: "Good GTM Engineer role",
    stack: ["Python", "HubSpot", "Supabase"],
    comp_range: "$220K - $260K",
  },
  "r2": {
    archetype_primary: "gtm-engineering",
    archetype_secondary: [],
    fit_score: 9,
    timestamp: "2026-05-15T09:00:00Z",
    verdict: "GTM Engineer in SF",
    stack: ["Python", "Salesforce"],
    comp_range: "$240K - $280K",
  },
};
const seen = {
  "r1": {
    title: "GTM Engineer",
    company: "Acme NYC",
    location_workplace: "hybrid",
    location_city: "New York",
    location_region: "NY",
    source: "ashby",
  },
  "r2": {
    title: "GTM Engineer",
    company: "SF Co",
    location_workplace: "hybrid",
    location_city: "San Francisco",
    location_region: "CA",
    source: "ashby",
  },
};

test("backtest — empty proposedRule produces zero deltas", () => {
  const { summary, rows } = runBacktest({ proposedRule: {}, enrichments, seen });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.delta, 0);
  }
  assert.equal(summary.improved, 0);
  assert.equal(summary.worsened, 0);
  assert.equal(summary.unchanged, 2);
});

test("backtest — softer SF penalty improves SF role only", () => {
  const proposedRule = { location_preferences: { hybrid_sf: -20 } };
  const { summary, rows } = runBacktest({ proposedRule, enrichments, seen });
  const sf = rows.find((r) => r.url === "r2");
  const nyc = rows.find((r) => r.url === "r1");
  assert.ok(sf, "expected SF row");
  assert.ok(nyc, "expected NYC row");
  assert.ok(sf.delta > 0, `expected SF role to improve, got delta=${sf.delta}`);
  assert.equal(nyc.delta, 0);
  assert.ok(summary.improved >= 1);
});

test("backtest — biggest_mover identifies the largest absolute change", () => {
  const proposedRule = { location_preferences: { hybrid_sf: 0 } }; // remove -40 penalty entirely
  const { summary } = runBacktest({ proposedRule, enrichments, seen });
  assert.ok(summary.biggest_mover);
  assert.equal(summary.biggest_mover.url, "r2");
});

test("backtest — rejects missing proposedRule", () => {
  assert.throws(() => runBacktest({}), /proposedRule.*required/);
});

test("backtest — sampleSize caps rows", () => {
  const { rows } = runBacktest({ proposedRule: {}, sampleSize: 1, enrichments, seen });
  assert.equal(rows.length, 1);
});
