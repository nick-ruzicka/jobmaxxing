import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustScore,
  loadUserContext,
  clearUserContextCache,
} from "./scoring-layer.mjs";
import { loadArchetypeConfig } from "./archetype-config.mjs";

// Fix D (the philosophical change, 2026-05-18): the comp:below_floor penalty
// now uses the MIDPOINT of the comp range (not the min) when comparing against
// floor_usd. Rationale: a band like $191K-$249K straddles the $200K floor —
// the midpoint $220K is the more honest "expected" comp. The min-based check
// punished roles where the candidate could plausibly negotiate at the high
// end. Single-value comps (where min==max) behave identically to before.

clearUserContextCache();
loadUserContext();
loadArchetypeConfig();

function roleWithComp(comp_range, extras = {}) {
  return {
    title: "GTM Engineer",
    company: "Acme",
    location_workplace: "hybrid",
    location_city: "new york",
    location_region: "ny",
    comp_range,
    description: "",
    ...extras,
  };
}

test("scoring-layer Fix D — Airtable case $191K-$249K does NOT trigger comp:below_floor", () => {
  // Mid = $220K > $200K floor → no penalty.
  const result = adjustScore(9, roleWithComp("$191,000 – $249,300 /yr"), "gtm-engineering");
  const comp = result.adjustments.find((a) => a.source.startsWith("comp:"));
  assert.equal(comp, undefined, `expected no comp adjustment, got: ${JSON.stringify(comp)}`);
});

test("scoring-layer Fix D — Notion-style $150K-$190K STILL triggers comp:below_floor", () => {
  // Mid = $170K < $200K floor → penalty fires.
  const result = adjustScore(7, roleWithComp("$150,000 – $190,000 /yr"), "gtm-engineering");
  const comp = result.adjustments.find((a) => a.source === "comp:below_floor");
  assert.ok(comp, "below_floor should fire when entire band is below floor");
  assert.equal(comp.delta, -50);
});

test("scoring-layer Fix D — narrow straddle $195K-$215K does NOT trigger (mid $205K above floor)", () => {
  const result = adjustScore(7, roleWithComp("$195K - $215K"), "gtm-engineering");
  const comp = result.adjustments.find((a) => a.source === "comp:below_floor");
  assert.equal(comp, undefined);
});

test("scoring-layer Fix D — barely-straddle $170K-$220K still triggers (mid $195K below floor)", () => {
  const result = adjustScore(7, roleWithComp("$170K - $220K"), "gtm-engineering");
  const comp = result.adjustments.find((a) => a.source === "comp:below_floor");
  assert.ok(comp, "asymmetric straddle with low mid should still penalize");
});

test("scoring-layer Fix D — single-value $180K still triggers (min == max == mid < floor)", () => {
  // Single-value comp behaves identically to before (min === max === mid).
  const result = adjustScore(7, roleWithComp("$180,000"), "gtm-engineering");
  const comp = result.adjustments.find((a) => a.source === "comp:below_floor");
  assert.ok(comp);
});

test("scoring-layer Fix D — single-value at floor $200K does NOT trigger", () => {
  const result = adjustScore(7, roleWithComp("$200,000"), "gtm-engineering");
  const comp = result.adjustments.find((a) => a.source === "comp:below_floor");
  assert.equal(comp, undefined);
});

test("scoring-layer Fix D — reason text reflects midpoint when range used", () => {
  // Reason text was 'min $X < floor $Y' under old logic — must now say mid for
  // ranges so future debugging shows the actual check that fired.
  const result = adjustScore(7, roleWithComp("$150K - $190K"), "gtm-engineering");
  const comp = result.adjustments.find((a) => a.source === "comp:below_floor");
  assert.match(comp.reason, /mid \$170,000 < floor \$200,000/);
});
