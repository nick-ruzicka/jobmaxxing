import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMinComp, extractMaxComp, compMidpoint } from "./comp-parse.mjs";

// ─── extractMinComp ─────────────────────────────────────────────────────────

test("extractMinComp — dollar range with k suffix", () => {
  assert.equal(extractMinComp("$150k - $200k"), 150000);
});

test("extractMinComp — comma-formatted range", () => {
  assert.equal(extractMinComp("$150,000 to $200,000"), 150000);
});

test("extractMinComp — single value with plus", () => {
  assert.equal(extractMinComp("$150,000+"), 150000);
});

test("extractMinComp — bare numbers under 1000 are treated as thousands", () => {
  assert.equal(extractMinComp("150-200k"), 150000);
});

test("extractMinComp — millions suffix", () => {
  assert.equal(extractMinComp("$1.2M"), 1200000);
});

test("extractMinComp — no number returns null", () => {
  assert.equal(extractMinComp("competitive"), null);
});

test("extractMinComp — not listed returns null", () => {
  assert.equal(extractMinComp("not listed"), null);
});

test("extractMinComp — empty string returns null", () => {
  assert.equal(extractMinComp(""), null);
});

// ─── extractMaxComp ─────────────────────────────────────────────────────────

test("extractMaxComp — picks the largest dollar figure in a range", () => {
  assert.equal(extractMaxComp("$150k - $200k"), 200000);
});

test("extractMaxComp — equity percentage does not become the max", () => {
  assert.equal(extractMaxComp("$220K-$260K base + 0.25% equity"), 260000);
});

test("extractMaxComp — single value equals the only figure", () => {
  assert.equal(extractMaxComp("$150,000+"), 150000);
});

test("extractMaxComp — no number returns null", () => {
  assert.equal(extractMaxComp("negotiable"), null);
});

test("extractMaxComp — empty/undefined returns null", () => {
  assert.equal(extractMaxComp(""), null);
  assert.equal(extractMaxComp(undefined), null);
});

// ─── compMidpoint (Fix D semantics) ─────────────────────────────────────────

test("compMidpoint — midpoint of a two-ended range", () => {
  // Fix D canonical example: $191K-$249K straddles the $200K floor; midpoint $220K.
  assert.equal(compMidpoint("$191K-$249K"), 220000);
});

test("compMidpoint — even range midpoint", () => {
  assert.equal(compMidpoint("$150k - $200k"), 175000);
});

test("compMidpoint — single value equals that value", () => {
  assert.equal(compMidpoint("$150,000+"), 150000);
});

test("compMidpoint — equity tail does not drag the midpoint", () => {
  assert.equal(compMidpoint("$220K-$260K base + 0.25% equity"), 240000);
});

test("compMidpoint — unparseable comp returns null", () => {
  assert.equal(compMidpoint("not listed"), null);
  assert.equal(compMidpoint("competitive"), null);
  assert.equal(compMidpoint(""), null);
});
