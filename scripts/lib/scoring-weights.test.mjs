import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTITUTIONAL_BOOST, TITLE_SIGNAL_WEIGHTS } from "./scoring-weights.mjs";

// These pin the CURRENT magnitudes. They are intentionally different between the
// classifier (saturates toward 100) and the scoring layer (small fit uplift).
// Changing a value here is a deliberate scoring-math decision.

test("scoring-weights — institutional boost (classifier)", () => {
  assert.deepEqual(INSTITUTIONAL_BOOST.classifier, { stablecoin_tier: 60, tier_1: 20, tier_2: 10 });
});

test("scoring-weights — institutional boost (scoring layer)", () => {
  assert.deepEqual(INSTITUTIONAL_BOOST.scoringLayer, { stablecoin_tier: 35, tier_1: 12, tier_2: 6 });
});

test("scoring-weights — title-signal weights (classifier)", () => {
  assert.deepEqual(TITLE_SIGNAL_WEIGHTS.classifier, { high_match: 100, medium_match: 50, low_match: 20 });
});

test("scoring-weights — title-signal weights (scoring layer)", () => {
  assert.deepEqual(TITLE_SIGNAL_WEIGHTS.scoringLayer, { high_match: 8, medium_match: 4 });
});
