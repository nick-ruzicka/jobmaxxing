import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  loadArchetypeConfig,
  getArchetype,
  getAllArchetypes,
  getGlobalDisqualifiers,
  ARCHETYPE_IDS,
  clearCache,
} from "./archetype-config.mjs";

// ─── real-file integration ────────────────────────────────────────────────────

test("archetype-config — real archetypes.yaml loads with all 5 archetypes", () => {
  clearCache();
  const config = loadArchetypeConfig();
  assert.equal(config.archetypes.length, 5);
  const ids = config.archetypes.map((a) => a.id);
  for (const expected of ARCHETYPE_IDS) {
    assert.ok(ids.includes(expected), `missing archetype: ${expected}`);
  }
});

test("archetype-config — every archetype has required fields", () => {
  const archetypes = getAllArchetypes();
  for (const a of archetypes) {
    assert.ok(a.id);
    assert.ok(a.name);
    assert.ok(a.description);
    assert.ok(a.maturity);
    assert.ok(a.resume);
  }
});

test("archetype-config — getArchetype returns specific archetype", () => {
  const a = getArchetype("gtm-engineering");
  assert.ok(a);
  assert.equal(a.id, "gtm-engineering");
  assert.equal(a.name, "GTM Engineer");
  assert.equal(a.maturity, "primary");
});

test("archetype-config — getArchetype returns undefined for unknown id", () => {
  assert.equal(getArchetype("nonexistent"), undefined);
});

test("archetype-config — web3-bizops inherits institutional_companies_boost from web3-bd", () => {
  const bd = getArchetype("web3-bd");
  const bizops = getArchetype("web3-bizops");
  assert.ok(Array.isArray(bd.institutional_companies_boost.tier_1));
  assert.ok(Array.isArray(bizops.institutional_companies_boost.tier_1));
  assert.deepEqual(
    bizops.institutional_companies_boost.tier_1,
    bd.institutional_companies_boost.tier_1,
  );
  // inherit_from key is removed after resolution
  assert.equal(bizops.institutional_companies_boost.inherit_from, undefined);
});

test("archetype-config — institutional_companies_boost is deep-copied, not aliased", () => {
  const bd = getArchetype("web3-bd");
  const bizops = getArchetype("web3-bizops");
  assert.notEqual(bd.institutional_companies_boost, bizops.institutional_companies_boost);
  assert.notEqual(bd.institutional_companies_boost.tier_1, bizops.institutional_companies_boost.tier_1);
});

test("archetype-config — global disqualifiers loaded", () => {
  const gd = getGlobalDisqualifiers();
  assert.ok(Array.isArray(gd.location));
  assert.ok(Array.isArray(gd.industries_blocked));
  assert.equal(gd.comp_below, undefined, "comp_below was removed in favor of user-context floor_usd");
});

test("archetype-config — gtm-engineering has 4 reward_signals groups with numeric weights", () => {
  const a = getArchetype("gtm-engineering");
  assert.equal(a.reward_signals.length, 4);
  for (const rs of a.reward_signals) {
    assert.ok(Array.isArray(rs.keywords));
    assert.equal(typeof rs.weight, "number");
  }
});

// ─── validation errors ────────────────────────────────────────────────────────

function writeFixture(yaml) {
  const path = join(tmpdir(), `archetypes-test-${process.pid}-${Date.now()}.yaml`);
  writeFileSync(path, yaml);
  return path;
}

test("archetype-config — empty file rejected", () => {
  const path = writeFixture("");
  assert.throws(() => loadArchetypeConfig(path), /must be a list|empty/);
  unlinkSync(path);
});

test("archetype-config — missing required field rejected", () => {
  const path = writeFixture(`
archetypes:
  - id: incomplete
    name: Incomplete
`);
  assert.throws(() => loadArchetypeConfig(path), /missing required field/);
  unlinkSync(path);
});

test("archetype-config — duplicate id rejected", () => {
  const path = writeFixture(`
archetypes:
  - id: dupe
    name: One
    description: x
    maturity: primary
    resume: x.html
  - id: dupe
    name: Two
    description: y
    maturity: primary
    resume: y.html
`);
  assert.throws(() => loadArchetypeConfig(path), /duplicate archetype id/);
  unlinkSync(path);
});

test("archetype-config — invalid maturity rejected", () => {
  const path = writeFixture(`
archetypes:
  - id: x
    name: x
    description: x
    maturity: yolo
    resume: x.html
`);
  assert.throws(() => loadArchetypeConfig(path), /invalid maturity/);
  unlinkSync(path);
});

test("archetype-config — inherit_from to unknown archetype rejected", () => {
  const path = writeFixture(`
archetypes:
  - id: a
    name: A
    description: a
    maturity: primary
    resume: a.html
    institutional_companies_boost:
      inherit_from: nonexistent
`);
  assert.throws(() => loadArchetypeConfig(path), /references unknown archetype/);
  unlinkSync(path);
});

test("archetype-config — reward_signal without numeric weight rejected", () => {
  const path = writeFixture(`
archetypes:
  - id: x
    name: x
    description: x
    maturity: primary
    resume: x.html
    reward_signals:
      - keywords: [a, b]
        weight: heavy
`);
  assert.throws(() => loadArchetypeConfig(path), /numeric weight/);
  unlinkSync(path);
});
