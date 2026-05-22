import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUZZY_SUFFIXES,
  PRIMARY_ARCHETYPES,
  PRIMARY_ARCHETYPES_SET,
  companyCandidateKeys,
} from "./company-matching.mjs";

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

test("companyCandidateKeys — canonical fuzzy examples (pins integration behavior)", () => {
  assert.deepEqual(companyCandidateKeys("Mistral AI"), ["mistralai", "mistral"]);
  assert.deepEqual(companyCandidateKeys("EliseAI"), ["eliseai", "elise"]);
  assert.ok(companyCandidateKeys("Anthropic Labs").includes("anthropic"));
  assert.ok(companyCandidateKeys("HirebaseIo").includes("hirebase"));
  assert.ok(companyCandidateKeys("CompanyHQ").includes("company"));
  assert.deepEqual(companyCandidateKeys("Rillet"), ["rillet"]);
});

test("companyCandidateKeys — un-normalized input is normalized (A2 fallback)", () => {
  // Raw display name with spaces/case → same as the pre-normalized form.
  assert.deepEqual(companyCandidateKeys("Mistral AI"), companyCandidateKeys("mistralai"));
});

test("companyCandidateKeys — dedups (no repeated entries)", () => {
  const out = companyCandidateKeys("Mistral AI");
  assert.equal(out.length, new Set(out).size);
});

test("companyCandidateKeys — empty/garbage input returns []", () => {
  assert.deepEqual(companyCandidateKeys(""), []);
  assert.deepEqual(companyCandidateKeys("!!!"), []);
});
