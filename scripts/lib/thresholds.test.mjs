import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRIEFING_APPLY_THRESHOLD,
  BRIEFING_MISSED_THRESHOLD,
  BRIEFING_RECALIBRATE_MIN,
  BRIEFING_RECALIBRATE_MAX,
  STALE_APPLICATION_DAYS,
  CHAT_PRUNING_DAYS,
  FEEDBACK_CONFLICT_THRESHOLD,
} from "./thresholds.mjs";

test("thresholds — briefing fit-score thresholds have expected values", () => {
  assert.equal(BRIEFING_APPLY_THRESHOLD, 6);
  assert.equal(BRIEFING_MISSED_THRESHOLD, 7);
  assert.equal(BRIEFING_RECALIBRATE_MIN, 4);
  assert.equal(BRIEFING_RECALIBRATE_MAX, 6);
});

test("thresholds — time windows have expected values", () => {
  assert.equal(STALE_APPLICATION_DAYS, 3);
  assert.equal(CHAT_PRUNING_DAYS, 30);
});

test("thresholds — feedback conflict threshold (0-5 eval scale)", () => {
  assert.equal(FEEDBACK_CONFLICT_THRESHOLD, 4.0);
});

test("thresholds — recalibrate band is internally consistent", () => {
  assert.ok(BRIEFING_RECALIBRATE_MIN < BRIEFING_RECALIBRATE_MAX);
  assert.equal(BRIEFING_RECALIBRATE_MAX, BRIEFING_APPLY_THRESHOLD);
});
