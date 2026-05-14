import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeClaudeCost,
  CLAUDE_PRICING,
} from "./scan-jobs-instrumentation.mjs";

test("computeClaudeCost — sonnet-4 known model", () => {
  // 1_000_000 input tokens × $3 + 500_000 output × $15 = $3 + $7.50 = $10.50
  const cost = computeClaudeCost({
    input_tokens: 1_000_000,
    output_tokens: 500_000,
    model: "claude-sonnet-4-20250514",
  });
  assert.equal(cost, 10.5);
});

test("computeClaudeCost — opus-4 (more expensive)", () => {
  // 100_000 input × $15 = $1.50 + 50_000 output × $75 = $3.75 → $5.25
  const cost = computeClaudeCost({
    input_tokens: 100_000,
    output_tokens: 50_000,
    model: "claude-opus-4-7",
  });
  assert.equal(cost, 5.25);
});

test("computeClaudeCost — unknown model uses default rate", () => {
  const cost = computeClaudeCost({
    input_tokens: 1_000_000,
    output_tokens: 0,
    model: "totally-made-up-model",
  });
  // Default is sonnet-4 prices for the time being
  assert.equal(cost, CLAUDE_PRICING.default.input_per_mtok);
});

test("computeClaudeCost — returns null on missing usage", () => {
  assert.equal(
    computeClaudeCost({ output_tokens: 100, model: "x" }),
    null,
  );
  assert.equal(
    computeClaudeCost({ input_tokens: 100, model: "x" }),
    null,
  );
});

test("computeClaudeCost — rounds to 6 decimals (no float fuzz)", () => {
  // 1 input token at $3/MTok = $0.000003 — should be exactly 0.000003 after rounding.
  const cost = computeClaudeCost({
    input_tokens: 1,
    output_tokens: 0,
    model: "claude-sonnet-4-20250514",
  });
  assert.equal(cost, 0.000003);
});
