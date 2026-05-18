import { test } from "node:test";
import assert from "node:assert/strict";
import { getCompFloorUsd, formatCompFloorString } from "./comp-floor.mjs";

test("getCompFloorUsd — returns the canonical floor from user-context.yaml", () => {
  const floor = getCompFloorUsd();
  assert.equal(typeof floor, "number");
  assert.ok(floor > 0);
});

test("formatCompFloorString — 200000 → '$200K'", () => {
  assert.equal(formatCompFloorString(200000), "$200K");
});

test("formatCompFloorString — 150000 → '$150K'", () => {
  assert.equal(formatCompFloorString(150000), "$150K");
});

test("formatCompFloorString — 250000 → '$250K'", () => {
  assert.equal(formatCompFloorString(250000), "$250K");
});

test("formatCompFloorString — non-multiple-of-1000 keeps fractional K", () => {
  assert.equal(formatCompFloorString(199500), "$199.5K");
});
