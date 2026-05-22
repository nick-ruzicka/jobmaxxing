import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGoalFallback } from "./default-goal.mjs";

test("defaultGoalFallback — interpolates the floor string", () => {
  assert.equal(
    defaultGoalFallback("$200K"),
    "GTM Engineer / RevOps roles, NYC area or remote, $200K+ floor, Series B+ companies",
  );
});

test("defaultGoalFallback — floor string is the only variable part", () => {
  assert.equal(
    defaultGoalFallback("$150K"),
    "GTM Engineer / RevOps roles, NYC area or remote, $150K+ floor, Series B+ companies",
  );
});
