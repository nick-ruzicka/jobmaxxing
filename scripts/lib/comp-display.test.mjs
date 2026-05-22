import { test } from "node:test";
import assert from "node:assert/strict";
import { hasRealComp, EMPTY_COMP_VALUES, QUALITATIVE_COMP_RE } from "./comp-display.mjs";

test("hasRealComp — real numeric ranges are real", () => {
  assert.equal(hasRealComp("$150K - $190K"), true);
  assert.equal(hasRealComp("$200,000"), true);
  assert.equal(hasRealComp("120k-160k"), true);
});

test("hasRealComp — empty/placeholder values are not real", () => {
  assert.equal(hasRealComp(""), false);
  assert.equal(hasRealComp("Not listed"), false);
  assert.equal(hasRealComp("none"), false);
  assert.equal(hasRealComp("N/A"), false);
  assert.equal(hasRealComp("not disclosed"), false);
  assert.equal(hasRealComp("unknown"), false);
});

test("hasRealComp — bare qualitative strings (no number) are not real", () => {
  assert.equal(hasRealComp("Competitive"), false);
  assert.equal(hasRealComp("market rate"), false);
  assert.equal(hasRealComp("negotiable"), false);
  assert.equal(hasRealComp("DOE"), false);
});

test("hasRealComp — qualitative WITH a number IS real", () => {
  assert.equal(hasRealComp("Competitive, ~$180K"), true);
});

test("hasRealComp — non-string inputs are not real", () => {
  assert.equal(hasRealComp(undefined), false);
  assert.equal(hasRealComp(null), false);
  assert.equal(hasRealComp(190000), false);
});

test("comp-display — exports the constants for reuse", () => {
  assert.ok(EMPTY_COMP_VALUES instanceof Set);
  assert.ok(EMPTY_COMP_VALUES.has("not listed"));
  assert.ok(QUALITATIVE_COMP_RE instanceof RegExp);
});
