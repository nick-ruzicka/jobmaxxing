// Tests for the v2-productization per-archetype qualification gate
// added in user-context.yaml.
//
// Two surfaces:
//   1. userQualifiesForArchetype()      — pure helper, returns bool
//   2. adjustScore()                    — integration: skips archetype lens
//                                          when the gate says "no"

import test from "node:test";
import assert from "node:assert/strict";

import {
  adjustScore,
  userQualifiesForArchetype,
} from "./scoring-layer.mjs";

// ─── userQualifiesForArchetype — direct helper tests ─────────────────────────

test("archetype-fit — no archetype_fit block → qualified (backward-compat)", () => {
  assert.equal(userQualifiesForArchetype({}, "fde", {}), true);
  assert.equal(userQualifiesForArchetype({ archetype_fit: {} }, "fde", {}), true);
});

test("archetype-fit — missing per-archetype config → qualified", () => {
  const ctx = { archetype_fit: { fde: { qualified: true } } };
  assert.equal(userQualifiesForArchetype(ctx, "ai-operations", {}), true);
});

test("archetype-fit — qualified=false → NOT qualified", () => {
  const ctx = { archetype_fit: { web3: { qualified: false } } };
  assert.equal(userQualifiesForArchetype(ctx, "web3", {}), false);
});

test("archetype-fit — confidence_floor blocks low-confidence classifications", () => {
  const ctx = { archetype_fit: { fde: { qualified: true, confidence_floor: 0.5 } } };
  assert.equal(
    userQualifiesForArchetype(ctx, "fde", { archetype_confidence: 0.3 }),
    false,
    "0.3 < 0.5 → blocked",
  );
  assert.equal(
    userQualifiesForArchetype(ctx, "fde", { archetype_confidence: 0.5 }),
    true,
    "0.5 == 0.5 → passes",
  );
  assert.equal(
    userQualifiesForArchetype(ctx, "fde", { archetype_confidence: 0.9 }),
    true,
    "0.9 > 0.5 → passes",
  );
});

test("archetype-fit — confidence_floor skipped when role has no archetype_confidence", () => {
  const ctx = { archetype_fit: { fde: { qualified: true, confidence_floor: 0.7 } } };
  // No archetype_confidence on the role — we don't penalize for missing data.
  assert.equal(userQualifiesForArchetype(ctx, "fde", {}), true);
});

test("archetype-fit — qualified=false overrides confidence_floor", () => {
  const ctx = { archetype_fit: { web3: { qualified: false, confidence_floor: 0.0 } } };
  assert.equal(
    userQualifiesForArchetype(ctx, "web3", { archetype_confidence: 1.0 }),
    false,
    "qualified:false beats any confidence",
  );
});

// ─── adjustScore integration — gate skips the archetype lens ─────────────────

test("adjustScore — archetype lens applied when user is qualified", () => {
  const ctx = {
    archetype_fit: { "gtm-engineering": { qualified: true, confidence_floor: 0.3 } },
  };
  const result = adjustScore(
    7,
    {
      title: "GTM Engineer",
      company: "Acme",
      description: "Build outbound signal infrastructure with Python and HubSpot. Customer-facing engineering. RevOps tooling.",
      archetype_confidence: 0.9,
    },
    "gtm-engineering",
    [],
    { userContext: ctx },
  );
  const arch = result.adjustments.find((a) => a.source.startsWith("archetype:gtm-engineering"));
  assert.ok(arch, "archetype lens fires");
  assert.ok(arch.delta > 0, `expected positive delta, got ${arch.delta}`);
});

test("adjustScore — archetype lens SKIPPED when user is NOT qualified", () => {
  const ctx = {
    archetype_fit: { "gtm-engineering": { qualified: false } },
  };
  const result = adjustScore(
    7,
    {
      title: "GTM Engineer",
      company: "Acme",
      description: "Build outbound signal infrastructure with Python and HubSpot. Customer-facing engineering. RevOps tooling.",
    },
    "gtm-engineering",
    [],
    { userContext: ctx },
  );
  const arch = result.adjustments.find((a) => a.source.startsWith("archetype:gtm-engineering"));
  assert.equal(arch, undefined, "archetype lens should be skipped — user is unqualified");
});

test("adjustScore — archetype lens SKIPPED when confidence < floor", () => {
  const ctx = {
    archetype_fit: { fde: { qualified: true, confidence_floor: 0.6 } },
  };
  const result = adjustScore(
    7,
    {
      title: "Forward Deployed Engineer",
      company: "Acme",
      description: "Embedded with customers deploying production AI systems. Forward Deployed work.",
      archetype_confidence: 0.4, // below the 0.6 floor
    },
    "fde",
    [],
    { userContext: ctx },
  );
  const arch = result.adjustments.find((a) => a.source.startsWith("archetype:fde"));
  assert.equal(arch, undefined, "archetype lens should be skipped — confidence below floor");
});

test("adjustScore — secondary archetype gated independently from primary", () => {
  const ctx = {
    archetype_fit: {
      "gtm-engineering": { qualified: true },
      fde: { qualified: false },
    },
  };
  const result = adjustScore(
    7,
    {
      title: "GTM Engineer",
      company: "Acme",
      description: "Build outbound signal engines on Python + HubSpot + Claude API. Customer-facing engineering. RevOps. Forward Deployed work with customer-facing engineering.",
    },
    "gtm-engineering",
    ["fde"],
    { userContext: ctx },
  );
  const primary = result.adjustments.find((a) => a.source === "archetype:gtm-engineering");
  const secondary = result.adjustments.find((a) => a.source === "archetype:fde:secondary");
  assert.ok(primary, "primary gtm-engineering lens fires (qualified=true)");
  assert.equal(secondary, undefined, "secondary fde lens skipped (qualified=false)");
});
