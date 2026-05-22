import { test } from "node:test";
import assert from "node:assert/strict";
import { FUZZY_SUFFIXES, PRIMARY_ARCHETYPES, PRIMARY_ARCHETYPES_SET } from "./company-matching.mjs";

test("company-matching — FUZZY_SUFFIXES is the canonical suffix list", () => {
  assert.deepEqual(FUZZY_SUFFIXES, ["ai", "labs", "tech", "io", "hq", "app", "xyz"]);
});

test("company-matching — PRIMARY_ARCHETYPES is the canonical primary list", () => {
  assert.deepEqual(PRIMARY_ARCHETYPES, ["gtm-engineering", "ai-operations", "fde"]);
});

test("company-matching — PRIMARY_ARCHETYPES_SET mirrors the array", () => {
  assert.ok(PRIMARY_ARCHETYPES_SET instanceof Set);
  assert.deepEqual([...PRIMARY_ARCHETYPES_SET].sort(), [...PRIMARY_ARCHETYPES].sort());
  assert.equal(PRIMARY_ARCHETYPES_SET.size, PRIMARY_ARCHETYPES.length);
});
