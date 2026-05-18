import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustScore,
  loadUserContext,
  clearUserContextCache,
} from "./scoring-layer.mjs";
import { loadArchetypeConfig } from "./archetype-config.mjs";

// Background: config/archetypes.yaml declares
//   global_disqualifiers:
//     location: ["fully on-site SF", "fully on-site LA", "fully on-site Seattle",
//                "fully on-site Austin", "fully on-site Chicago"]
// but checkDisqualifiers historically only read .industries_blocked. The location
// list was loaded into memory and never consulted — so "Nick's stated deal-breaker
// of no on-site SF/LA/Chicago/Austin/Seattle" was scored as a heavy floor-clamp
// (-75 → 0) instead of an explicit hard-no. These tests pin the new behavior:
// onsite SF/LA/Seattle/Austin/Chicago → disqualified: true, reason: location:…

clearUserContextCache();
const CTX = loadUserContext();
const ARCH = loadArchetypeConfig();

function roleAt(workplace, city, extras = {}) {
  return {
    title: "GTM Engineer",
    company: "Acme",
    location_workplace: workplace,
    location_city: city,
    location_region: null,
    description: "",
    ...extras,
  };
}

test("scoring-layer — onsite SF is HARD-DQ'd via global_disqualifiers.location", () => {
  const result = adjustScore(7, roleAt("onsite", "san francisco"), "gtm-engineering");
  assert.equal(result.disqualified, true, "onsite SF should be disqualified");
  assert.match(result.disqualification_reason || "", /location.*sf/i,
    `disqualification_reason should mention 'sf', got: ${result.disqualification_reason}`);
  assert.equal(result.adjusted_score, 0);
});

test("scoring-layer — onsite LA is hard-DQ'd", () => {
  const result = adjustScore(7, roleAt("onsite", "los angeles"), "gtm-engineering");
  assert.equal(result.disqualified, true);
  assert.match(result.disqualification_reason || "", /location.*la/i);
});

test("scoring-layer — onsite Chicago is hard-DQ'd", () => {
  const result = adjustScore(7, roleAt("onsite", "chicago"), "gtm-engineering");
  assert.equal(result.disqualified, true);
});

test("scoring-layer — onsite Austin is hard-DQ'd", () => {
  const result = adjustScore(7, roleAt("onsite", "austin"), "gtm-engineering");
  assert.equal(result.disqualified, true);
});

test("scoring-layer — onsite Seattle is hard-DQ'd", () => {
  const result = adjustScore(7, roleAt("onsite", "seattle"), "gtm-engineering");
  assert.equal(result.disqualified, true);
});

test("scoring-layer — hybrid SF is NOT hard-DQ'd (only floor-penalized via -40)", () => {
  // The DQ list is for FULLY on-site only. Hybrid SF remains a heavy penalty,
  // not an explicit rejection.
  const result = adjustScore(7, roleAt("hybrid", "san francisco"), "gtm-engineering");
  assert.equal(result.disqualified, false, "hybrid SF should NOT be DQ'd");
});

test("scoring-layer — onsite NYC is NOT hard-DQ'd (NYC is the bias)", () => {
  const result = adjustScore(7, roleAt("onsite", "new york"), "gtm-engineering");
  assert.equal(result.disqualified, false);
});

test("scoring-layer — onsite Boston is NOT hard-DQ'd (not in the list)", () => {
  // Boston isn't in the global_disqualifiers.location list. Should still fall
  // through to the regular location penalty path.
  const result = adjustScore(7, roleAt("onsite", "boston"), "gtm-engineering");
  assert.equal(result.disqualified, false);
});

test("scoring-layer — empty global_disqualifiers.location preserves old behavior", () => {
  // When config has no location list, behavior is the old floor-clamp path.
  const archetypeConfigSansLocation = {
    ...ARCH,
    global_disqualifiers: { ...ARCH.global_disqualifiers, location: [] },
  };
  const result = adjustScore(
    7,
    roleAt("onsite", "san francisco"),
    "gtm-engineering",
    [],
    { archetypeConfig: archetypeConfigSansLocation },
  );
  assert.equal(result.disqualified, false, "no location DQ when list is empty");
});

test("scoring-layer — Gumloop (the trigger case): onsite SF → DQ", () => {
  // This is the role that exposed the bug: workplace onsite, city san francisco
  // after the ATS upgrade pass. Should now hard-DQ instead of scoring 7.8.
  const result = adjustScore(7, {
    title: "GTM Operations Lead",
    company: "Gumloop",
    location_workplace: "onsite",
    location_city: "san francisco",
    location_region: null,
    description: "",
  }, "ai-operations");
  assert.equal(result.disqualified, true);
  assert.equal(result.adjusted_score, 0);
});
