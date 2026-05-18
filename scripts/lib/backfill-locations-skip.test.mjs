import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSkipBackfill } from "./backfill-locations-skip.mjs";

// The bug being fixed: the old predicate was `typeof entry.location_workplace === "string"`,
// which considers "unknown" (a string) as "already structured" and skips it. That left
// Tier-8-discovered ATS URLs permanently un-upgraded — Gumloop (SF) stayed at workplace
// "unknown" through every backfill run.

test("shouldSkipBackfill — true when workplace is 'onsite'", () => {
  assert.equal(shouldSkipBackfill({ location_workplace: "onsite" }), true);
});

test("shouldSkipBackfill — true when workplace is 'hybrid'", () => {
  assert.equal(shouldSkipBackfill({ location_workplace: "hybrid" }), true);
});

test("shouldSkipBackfill — true when workplace is 'remote'", () => {
  assert.equal(shouldSkipBackfill({ location_workplace: "remote" }), true);
});

test("shouldSkipBackfill — FALSE when workplace is 'unknown' (the bug)", () => {
  // The whole point of the fix: re-evaluate entries that previously came back unknown.
  assert.equal(shouldSkipBackfill({ location_workplace: "unknown" }), false);
});

test("shouldSkipBackfill — false when location_workplace missing entirely (legacy entry)", () => {
  assert.equal(shouldSkipBackfill({}), false);
  assert.equal(shouldSkipBackfill({ location_workplace: null }), false);
  assert.equal(shouldSkipBackfill({ location_workplace: undefined }), false);
});

test("shouldSkipBackfill — false when workplace is an empty string", () => {
  // Empty string is a degenerate signal; should re-evaluate.
  assert.equal(shouldSkipBackfill({ location_workplace: "" }), false);
});
