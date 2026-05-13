import { test } from "node:test";
import assert from "node:assert/strict";
import { computeChipCounts } from "./chip-counts.mjs";

// Mimic the FilterBar bucketLocation function — same logic, kept here so
// the test fixture stays self-contained.
function bucketLocation(loc) {
  const l = (loc || "").toLowerCase();
  if (l.includes("nyc") || l === "new york") return "NYC";
  if (l.includes("remote")) return "Remote";
  if (l.includes("hybrid") && !l.includes("nyc")) return "Hybrid";
  if (l === "unknown") return "Unknown";
  return "Other";
}

// Fixture: 5 regular + 3 aggregator roles, carefully chosen so removing
// aggregators changes every count we care about. Locations use the "nyc"
// substring so bucketLocation routes them to the NYC bucket (it matches
// `l.includes("nyc") || l === "new york"`, NOT "new york, ny").
const FIXTURE = [
  // --- 5 regular roles -----------------------------------------------------
  { status: "Discovered", location: "NYC",          source_tier: "tier1",      enrichment: { build_component: true,  ai_signal: true,  comp_range: "$200k-$240k" }, comp: "",      stale: false },
  { status: "Evaluated",  location: "Remote, US",   source_tier: "tier1",      enrichment: { build_component: false, ai_signal: true,  comp_range: "Not listed" }, comp: "",      stale: false },
  { status: "Discovered", location: "Hybrid SF",    source_tier: "tier2",      enrichment: { build_component: true,  ai_signal: false, comp_range: "$180k-$220k" }, comp: "",      stale: true  },
  { status: "Applied",    location: "NYC (hybrid)", source_tier: "tier1",      enrichment: { build_component: false, ai_signal: false                            }, comp: "$150k", stale: false },
  { status: "Discovered", location: "Remote",       source_tier: "tier3",      enrichment: { build_component: true,  ai_signal: true,  comp_range: "Not listed" }, comp: "",      stale: false },
  // --- 3 aggregator roles --------------------------------------------------
  { status: "Discovered", location: "NYC",          source_tier: "aggregator", enrichment: { build_component: true,  ai_signal: true,  comp_range: "$210k-$250k" }, comp: "",      stale: false },
  { status: "Discovered", location: "Remote",       source_tier: "aggregator", enrichment: { build_component: true,  ai_signal: false                            }, comp: "",      stale: true  },
  { status: "Evaluated",  location: "Hybrid TX",    source_tier: "aggregator", enrichment: { build_component: false, ai_signal: true                             }, comp: "$140k", stale: false },
];

test("computeChipCounts — default (includeAggregator=false) excludes aggregators", () => {
  const counts = computeChipCounts(FIXTURE, { bucketLocation });

  // NYC: only 2 of the 5 regular roles are NYC-bucketed (#1 + #4)
  assert.equal(counts.locBucketCounts.NYC, 2, "NYC chip count should not include the aggregator-NYC role");
  // Remote: 2 regular roles (#2 + #5)
  assert.equal(counts.locBucketCounts.Remote, 2, "Remote chip count should not include the aggregator-Remote role");
  // Hybrid: 1 regular role (#3) — #4 is bucketed NYC because of the "nyc" substring rule
  assert.equal(counts.locBucketCounts.Hybrid, 1);

  // Build: 3 regular roles flagged build_component (#1, #3, #5) — not the
  // aggregator builds (#6, #7)
  assert.equal(counts.buildCount, 3);
  // AI: 3 regular roles flagged ai_signal (#1, #2, #5)
  assert.equal(counts.aiCount, 3);

  // Comp: regular roles with comp_range != "Not listed" (#1, #3) + regular
  // with r.comp set (#4). Both branches run, so 3.
  assert.equal(counts.compCount, 3);

  // Stale: 1 regular role (#3); not the aggregator #7
  assert.equal(counts.staleCount, 1);

  // Status counts: only regular roles
  assert.equal(counts.statusCounts.Discovered, 3); // #1, #3, #5
  assert.equal(counts.statusCounts.Evaluated, 1);  // #2
  assert.equal(counts.statusCounts.Applied, 1);    // #4

  // aggCount: ALWAYS over the full set, never affected by the toggle
  assert.equal(counts.aggCount, 3);
});

test("computeChipCounts — includeAggregator=true includes everything", () => {
  const counts = computeChipCounts(FIXTURE, { bucketLocation, includeAggregator: true });

  // Now aggregator roles join the buckets too
  assert.equal(counts.locBucketCounts.NYC, 3);     // 2 regular + 1 aggregator
  assert.equal(counts.locBucketCounts.Remote, 3);  // 2 regular + 1 aggregator
  assert.equal(counts.locBucketCounts.Hybrid, 2);  // 1 regular + 1 aggregator (#8 = Austin hybrid)

  assert.equal(counts.buildCount, 5); // 3 regular + 2 aggregator (#6, #7)
  assert.equal(counts.aiCount, 5);    // 3 regular + 2 aggregator (#6, #8)
  // Comp counts include aggregator #6 (range) + #8 (r.comp) → 3 regular + 2 aggregator
  assert.equal(counts.compCount, 5);
  assert.equal(counts.staleCount, 2); // 1 regular + 1 aggregator (#7)

  assert.equal(counts.statusCounts.Discovered, 5); // 3 regular + 2 aggregator
  assert.equal(counts.statusCounts.Evaluated, 2);  // 1 regular + 1 aggregator
  assert.equal(counts.statusCounts.Applied, 1);

  // aggCount unchanged
  assert.equal(counts.aggCount, 3);
});

test("computeChipCounts — aggCount counts over the full set even when toggle is off", () => {
  const offCounts = computeChipCounts(FIXTURE, { bucketLocation, includeAggregator: false });
  const onCounts  = computeChipCounts(FIXTURE, { bucketLocation, includeAggregator: true });
  assert.equal(offCounts.aggCount, onCounts.aggCount);
  assert.equal(offCounts.aggCount, 3);
});

test("computeChipCounts — empty roles array → zeros, no throws", () => {
  const counts = computeChipCounts([], { bucketLocation });
  assert.deepEqual(counts.locBucketCounts, {});
  assert.deepEqual(counts.statusCounts, {});
  assert.equal(counts.buildCount, 0);
  assert.equal(counts.aiCount, 0);
  assert.equal(counts.compCount, 0);
  assert.equal(counts.staleCount, 0);
  assert.equal(counts.aggCount, 0);
});

test("computeChipCounts — null entries in the array are skipped without throwing", () => {
  const roles = [null, undefined, FIXTURE[0], null];
  const counts = computeChipCounts(roles, { bucketLocation });
  assert.equal(counts.statusCounts.Discovered, 1);
  assert.equal(counts.locBucketCounts.NYC, 1);
  assert.equal(counts.aggCount, 0);
});

test("computeChipCounts — falls back to identity bucketLocation when none passed", () => {
  const counts = computeChipCounts([
    { status: "Discovered", location: "Direct", source_tier: "tier1", enrichment: {} },
  ]);
  // No bucketing → buckets keyed by raw location string
  assert.equal(counts.locBucketCounts.Direct, 1);
});

test("computeChipCounts — Boolean(includeAggregator) gate behaves strictly", () => {
  // Anything not === true counts as "exclude aggregators"
  const truthy = computeChipCounts(FIXTURE, { bucketLocation, includeAggregator: "yes" });
  assert.equal(truthy.locBucketCounts.NYC, 2, "non-boolean truthy should not flip the gate");

  const undef = computeChipCounts(FIXTURE, { bucketLocation, includeAggregator: undefined });
  assert.equal(undef.locBucketCounts.NYC, 2);
});
