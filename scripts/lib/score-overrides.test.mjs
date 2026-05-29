import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOverride, applyScoreOverrides } from "./score-overrides.mjs";

// ─── resolveOverride: precedence block > boost > penalize ──────────────────────

const OV = {
  block: ["blockco"],
  boost: { jiko: { score: 4.2, reason: "boost reason" }, stuut: { score: 4.5, reason: "boost stuut" } },
  penalize: { hearth: { score: null, reason: "pen reason" }, rezolveai: { score: 1.8, reason: "pen scored" }, stuut: { score: null, reason: "pen stuut" } },
};

test("resolveOverride — block wins", () => {
  assert.deepEqual(resolveOverride(OV, "blockco"), { bucket: "block", score: null, reason: "Blocked — eval ≤ 1.5/5" });
});
test("resolveOverride — boost with eval score", () => {
  assert.deepEqual(resolveOverride(OV, "jiko"), { bucket: "boost", score: 4.2, reason: "boost reason" });
});
test("resolveOverride — penalize scored", () => {
  assert.deepEqual(resolveOverride(OV, "rezolveai"), { bucket: "penalize", score: 1.8, reason: "pen scored" });
});
test("resolveOverride — penalize unscored → score null", () => {
  assert.deepEqual(resolveOverride(OV, "hearth"), { bucket: "penalize", score: null, reason: "pen reason" });
});
test("resolveOverride — precedence: stuut in BOTH boost+penalize → boost wins", () => {
  assert.equal(resolveOverride(OV, "stuut").bucket, "boost");
  assert.equal(resolveOverride(OV, "stuut").score, 4.5);
});
test("resolveOverride — no match → null", () => {
  assert.equal(resolveOverride(OV, "nobody"), null);
});
test("resolveOverride — empty key → null", () => {
  assert.equal(resolveOverride(OV, ""), null);
});

// ─── applyScoreOverrides ───────────────────────────────────────────────────────

test("applyScoreOverrides — block → 1 regardless of base", () => {
  assert.equal(applyScoreOverrides(9, { bucket: "block", score: null }), 1);
  assert.equal(applyScoreOverrides(0, { bucket: "block", score: null }), 1);
});
test("applyScoreOverrides — boost scored → round(eval*2)", () => {
  assert.equal(applyScoreOverrides(3, { bucket: "boost", score: 4.2 }), 8);  // round(8.4)
  assert.equal(applyScoreOverrides(1, { bucket: "boost", score: 4.5 }), 9);  // round(9.0)
});
test("applyScoreOverrides — boost unscored → clamp(base+2)", () => {
  assert.equal(applyScoreOverrides(5, { bucket: "boost", score: null }), 7);
  assert.equal(applyScoreOverrides(9, { bucket: "boost", score: null }), 10); // clamped
});
test("applyScoreOverrides — penalize scored → round(eval*2)", () => {
  assert.equal(applyScoreOverrides(7, { bucket: "penalize", score: 1.8 }), 4); // round(3.6)
});
test("applyScoreOverrides — penalize unscored → min(base,4)", () => {
  assert.equal(applyScoreOverrides(7, { bucket: "penalize", score: null }), 4);
  assert.equal(applyScoreOverrides(2, { bucket: "penalize", score: null }), 2);
});
test("applyScoreOverrides — no override → base unchanged", () => {
  assert.equal(applyScoreOverrides(6, null), 6);
  assert.equal(applyScoreOverrides(0, null), 0);
});
test("applyScoreOverrides — boundary eval scores clamp to [1,10]", () => {
  assert.equal(applyScoreOverrides(5, { bucket: "boost", score: 0.4 }), 1); // round(0.8)=1
  assert.equal(applyScoreOverrides(5, { bucket: "boost", score: 6 }), 10);  // round(12)→10
});

// ─── stuut cross-surface convergence (the case that diverges today) ────────────

test("stuut — unified result is 9 (was scan min(base,4)+2 vs dashboard eval×2)", () => {
  // Same override data, same company key, two different base scores (scan heuristic
  // vs dashboard enriched). Boost precedence + eval×2 means base is IGNORED → both 9.
  const resolved = resolveOverride(OV, "stuut");
  const scanBase = 5;       // heuristic
  const dashboardBase = 8;  // enriched/priority
  const scanResult = applyScoreOverrides(scanBase, resolved);
  const dashResult = applyScoreOverrides(dashboardBase, resolved);
  assert.equal(scanResult, 9);
  assert.equal(dashResult, 9);
  assert.equal(scanResult, dashResult, "scan and dashboard must now agree for a scored boost");
});
