// Drift detector for the canonical-status constants embedded in the three
// pipeline-integrity scripts (`verify-pipeline.mjs`, `normalize-statuses.mjs`,
// `merge-tracker.mjs`) and `templates/states.yml`.
//
// These four files independently define the same set of canonical statuses
// and Spanish/English aliases. Today they drift quietly: if someone removes
// `Interview` from one but not the others, the only signal is a runtime
// pipeline failure on a real applications.md row. This test parses each
// file as text, extracts the constant set / map, and asserts:
//
//   1. Inline-snapshot assertion against the current canonical list / alias
//      map for each script — any addition or removal forces an explicit
//      snapshot update (failing the test, surfacing the change in review).
//   2. Cross-file consistency: all three scripts agree on the canonical
//      label set (modulo casing).
//   3. Cross-file consistency with templates/states.yml: every label in the
//      YAML appears in every script, and every alias on a YAML state appears
//      in at least one script's alias map (case-insensitive).
//
// Why text-parsing instead of importing the scripts: the scripts have no
// exports and run their main side effects on import (reading
// `data/applications.md`, `process.exit()`). Parsing the source as text is
// the least invasive way to extract their constants without modifying
// production code.
//
// If the constants are refactored to a shared module, this test should be
// rewritten to import that module directly. Flagged in PR takeaways.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- Source extractors ----------------------------------------------------

function readSource(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), "utf-8");
}

/** Extract the `CANONICAL_STATUSES = [...]` array literal from verify-pipeline.mjs. */
function extractVerifyCanonical(src) {
  const m = src.match(/const CANONICAL_STATUSES = \[([\s\S]*?)\];/);
  if (!m) throw new Error("CANONICAL_STATUSES literal not found in verify-pipeline.mjs");
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/['"]/g, ""))
    .filter(Boolean);
}

/** Extract the `ALIASES = { ... }` object literal from verify-pipeline.mjs. */
function extractVerifyAliases(src) {
  const m = src.match(/const ALIASES = \{([\s\S]*?)\};/);
  if (!m) throw new Error("ALIASES literal not found in verify-pipeline.mjs");
  const out = {};
  // Tolerate multi-pair lines like: 'a': 'x', 'b': 'x',
  const pairRe = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
  let pm;
  while ((pm = pairRe.exec(m[1])) !== null) {
    out[pm[1]] = pm[2];
  }
  return out;
}

/** Extract the `CANONICAL_STATES = [...]` array literal from merge-tracker.mjs. */
function extractMergeCanonical(src) {
  const m = src.match(/const CANONICAL_STATES = \[([\s\S]*?)\];/);
  if (!m) throw new Error("CANONICAL_STATES literal not found in merge-tracker.mjs");
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/['"]/g, ""))
    .filter(Boolean);
}

/** Extract the `aliases = { ... }` object literal from merge-tracker.mjs's validateStatus. */
function extractMergeAliases(src) {
  // Capture only the first `aliases = {` block (inside validateStatus).
  const m = src.match(/const aliases = \{([\s\S]*?)\n\s*\};/);
  if (!m) throw new Error("aliases literal not found in merge-tracker.mjs");
  const out = {};
  const pairRe = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
  let pm;
  while ((pm = pairRe.exec(m[1])) !== null) {
    out[pm[1]] = pm[2];
  }
  return out;
}

/** Extract the `canonical = [...]` array literal from normalize-statuses.mjs. */
function extractNormalizeCanonical(src) {
  const m = src.match(/const canonical = \[([\s\S]*?)\];/);
  if (!m) throw new Error("canonical literal not found in normalize-statuses.mjs");
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/['"]/g, ""))
    .filter(Boolean);
}

/**
 * Parse `templates/states.yml` (minimal hand-rolled parser — the file is a
 * fixed shape: top-level `states:` list of `{ id, label, aliases }` maps).
 * We avoid adding a YAML dependency at the project root just for tests.
 */
function parseStatesYml(src) {
  const states = [];
  let current = null;
  for (const rawLine of src.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("states:")) continue;
    const idMatch = line.match(/^\s+-\s+id:\s+(\S+)/);
    if (idMatch) {
      if (current) states.push(current);
      current = { id: idMatch[1], label: null, aliases: [] };
      continue;
    }
    if (!current) continue;
    const labelMatch = line.match(/^\s+label:\s+(.+)$/);
    if (labelMatch) {
      current.label = labelMatch[1].trim();
      continue;
    }
    const aliasMatch = line.match(/^\s+aliases:\s+\[(.*)\]/);
    if (aliasMatch) {
      current.aliases = aliasMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  if (current) states.push(current);
  return states;
}

// ---- Inline snapshots (UPDATE intentionally when constants change) -------

// verify-pipeline.mjs uses lowercase canonical names because its check
// lower-cases the row's status before comparing.
const VERIFY_CANONICAL_SNAPSHOT = [
  "evaluated",
  "applied",
  "responded",
  "interview",
  "offer",
  "rejected",
  "discarded",
  "skip",
];

const VERIFY_ALIASES_SNAPSHOT = {
  evaluada: "evaluated",
  condicional: "evaluated",
  hold: "evaluated",
  evaluar: "evaluated",
  verificar: "evaluated",
  aplicado: "applied",
  enviada: "applied",
  aplicada: "applied",
  applied: "applied",
  sent: "applied",
  respondido: "responded",
  entrevista: "interview",
  oferta: "offer",
  rechazado: "rejected",
  rechazada: "rejected",
  descartado: "discarded",
  descartada: "discarded",
  cerrada: "discarded",
  cancelada: "discarded",
  "no aplicar": "skip",
  no_aplicar: "skip",
  monitor: "skip",
  "geo blocker": "skip",
};

// merge-tracker.mjs uses the canonical English labels with proper casing.
const MERGE_CANONICAL_SNAPSHOT = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
  "SKIP",
];

const MERGE_ALIASES_SNAPSHOT = {
  evaluada: "Evaluated",
  condicional: "Evaluated",
  hold: "Evaluated",
  evaluar: "Evaluated",
  verificar: "Evaluated",
  aplicado: "Applied",
  enviada: "Applied",
  aplicada: "Applied",
  applied: "Applied",
  sent: "Applied",
  respondido: "Responded",
  entrevista: "Interview",
  oferta: "Offer",
  rechazado: "Rejected",
  rechazada: "Rejected",
  descartado: "Discarded",
  descartada: "Discarded",
  cerrada: "Discarded",
  cancelada: "Discarded",
  "no aplicar": "SKIP",
  no_aplicar: "SKIP",
  skip: "SKIP",
  monitor: "SKIP",
  "geo blocker": "SKIP",
};

// normalize-statuses.mjs has the canonical list inline (used as the
// case-insensitive identity check before the alias dict).
const NORMALIZE_CANONICAL_SNAPSHOT = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
  "SKIP",
];

// ---- Tests ----------------------------------------------------------------

describe("pipeline status constants — verify-pipeline.mjs", () => {
  const src = readSource("verify-pipeline.mjs");

  it("CANONICAL_STATUSES matches the pinned snapshot (drift detector)", () => {
    assert.deepEqual(extractVerifyCanonical(src), VERIFY_CANONICAL_SNAPSHOT);
  });

  it("ALIASES map matches the pinned snapshot (drift detector)", () => {
    assert.deepEqual(extractVerifyAliases(src), VERIFY_ALIASES_SNAPSHOT);
  });
});

describe("pipeline status constants — merge-tracker.mjs", () => {
  const src = readSource("merge-tracker.mjs");

  it("CANONICAL_STATES matches the pinned snapshot (drift detector)", () => {
    assert.deepEqual(extractMergeCanonical(src), MERGE_CANONICAL_SNAPSHOT);
  });

  it("aliases map matches the pinned snapshot (drift detector)", () => {
    assert.deepEqual(extractMergeAliases(src), MERGE_ALIASES_SNAPSHOT);
  });
});

describe("pipeline status constants — normalize-statuses.mjs", () => {
  const src = readSource("normalize-statuses.mjs");

  it("inline `canonical` list matches the pinned snapshot (drift detector)", () => {
    assert.deepEqual(
      extractNormalizeCanonical(src),
      NORMALIZE_CANONICAL_SNAPSHOT,
    );
  });
});

describe("pipeline status constants — cross-file consistency", () => {
  const verifySrc = readSource("verify-pipeline.mjs");
  const mergeSrc = readSource("merge-tracker.mjs");
  const normalizeSrc = readSource("normalize-statuses.mjs");

  it("all three scripts agree on the canonical set (case-insensitive)", () => {
    const verify = extractVerifyCanonical(verifySrc).map((s) => s.toLowerCase()).sort();
    const merge = extractMergeCanonical(mergeSrc).map((s) => s.toLowerCase()).sort();
    const norm = extractNormalizeCanonical(normalizeSrc)
      .map((s) => s.toLowerCase())
      .sort();
    assert.deepEqual(verify, merge, "verify ↔ merge canonical set drift");
    assert.deepEqual(merge, norm, "merge ↔ normalize canonical set drift");
  });

  it("verify-pipeline and merge-tracker share the same alias key set", () => {
    const verifyKeys = Object.keys(extractVerifyAliases(verifySrc)).sort();
    const mergeKeys = Object.keys(extractMergeAliases(mergeSrc)).sort();
    // merge-tracker has one extra: 'skip' → 'SKIP' (verify treats SKIP as
    // canonical via case-insensitive lookup, so doesn't need the alias).
    // Allow the symmetric difference to be exactly {'skip'} on merge's side.
    const diff = mergeKeys.filter((k) => !verifyKeys.includes(k));
    assert.deepEqual(
      diff.sort(),
      ["skip"],
      "merge-tracker should only differ from verify by the 'skip' self-alias",
    );
    const reverseDiff = verifyKeys.filter((k) => !mergeKeys.includes(k));
    assert.deepEqual(
      reverseDiff,
      [],
      `verify-pipeline has alias keys missing from merge-tracker: ${reverseDiff}`,
    );
  });
});

describe("pipeline status constants — templates/states.yml cross-check", () => {
  const yml = readSource("templates/states.yml");
  const states = parseStatesYml(yml);
  const verifySrc = readSource("verify-pipeline.mjs");
  const mergeSrc = readSource("merge-tracker.mjs");
  const normalizeSrc = readSource("normalize-statuses.mjs");

  it("states.yml parses to exactly 8 canonical states", () => {
    assert.equal(states.length, 8, `parsed states: ${JSON.stringify(states.map((s) => s.id))}`);
  });

  it("every states.yml label appears in each script's canonical list (case-insensitive)", () => {
    const ymlLabels = states.map((s) => s.label.toLowerCase()).sort();
    const verifyLabels = extractVerifyCanonical(verifySrc).map((s) => s.toLowerCase()).sort();
    const mergeLabels = extractMergeCanonical(mergeSrc).map((s) => s.toLowerCase()).sort();
    const normLabels = extractNormalizeCanonical(normalizeSrc)
      .map((s) => s.toLowerCase())
      .sort();
    assert.deepEqual(verifyLabels, ymlLabels, "verify-pipeline drifts from states.yml");
    assert.deepEqual(mergeLabels, ymlLabels, "merge-tracker drifts from states.yml");
    assert.deepEqual(normLabels, ymlLabels, "normalize-statuses drifts from states.yml");
  });

  it("every states.yml alias is present in at least one script's alias map", () => {
    const verifyAliases = new Set(Object.keys(extractVerifyAliases(verifySrc)));
    const mergeAliases = new Set(Object.keys(extractMergeAliases(mergeSrc)));
    const missing = [];
    for (const state of states) {
      for (const alias of state.aliases) {
        const a = alias.toLowerCase();
        if (!verifyAliases.has(a) && !mergeAliases.has(a)) {
          missing.push(`${state.id}: ${alias}`);
        }
      }
    }
    assert.deepEqual(
      missing,
      [],
      `states.yml aliases not covered by any script: ${missing.join(", ")}`,
    );
  });
});
