// Tests for the status normalizer (`normalize-statuses.mjs`).
//
// `normalize-statuses.mjs` lives at the repo root and is a CLI script with
// no exports. Its `normalizeStatus()` function rewrites raw status strings
// (Spanish aliases, mixed case, DUPLICADO, dates appended, em-dash, etc.)
// to one of eight canonical English labels and optionally moves disposition
// info into the notes column.
//
// Fixture strategy: same as `verify-pipeline.test.mjs` — copy the script
// into a fresh temp dir so `import.meta.url` resolves to the fixture, write
// `data/applications.md` with a single row whose status we want to test,
// run with `--dry-run`, and assert on the rewrite line that the script
// prints in the form `#<num>: "<old>" → "<new>"`.
//
// Coverage strategy:
// - One "table-driven" test enumerates every (alias → canonical) pair the
//   `normalizeStatus()` function claims to handle. The test name includes
//   the alias so failures point at the exact mapping.
// - A separate round-trip test asserts that every canonical label is
//   already canonical (no rewrite line printed, exit 0).
// - Targeted tests cover the non-alias branches: DUPLICADO + notes move,
//   Aplicado/Rechazado-with-trailing-date strip, MONITOR, GEO BLOCKER,
//   Repost #N → Discarded, empty / em-dash → Discarded, unknown status.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_SRC = join(REPO_ROOT, "normalize-statuses.mjs");

const HEADER = [
  "# Applications Tracker",
  "",
  "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
  "|---|------|---------|------|-------|--------|-----|--------|-------|",
].join("\n");

function makeFixture({ rawStatus, notes = "n" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "normalize-statuses-"));
  copyFileSync(SCRIPT_SRC, join(dir, "normalize-statuses.mjs"));
  mkdirSync(join(dir, "data"), { recursive: true });
  const dataRow = `| 1 | 2026-01-15 | Acme | Engineer | 4.5/5 | ${rawStatus} | ✅ | [1](reports/001.md) | ${notes} |`;
  writeFileSync(join(dir, "data/applications.md"), [HEADER, dataRow].join("\n"));
  return {
    dir,
    runDry() {
      return spawnSync(
        "node",
        [join(dir, "normalize-statuses.mjs"), "--dry-run"],
        { encoding: "utf-8" },
      );
    },
    runWrite() {
      return spawnSync(
        "node",
        [join(dir, "normalize-statuses.mjs")],
        { encoding: "utf-8" },
      );
    },
    readApps() {
      return readFileSync(join(dir, "data/applications.md"), "utf-8");
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Pairs of (input status, expected canonical output) — one row per alias
// or normalization branch in `normalize-statuses.mjs::normalizeStatus()`.
// Inputs intentionally mix casing where the script's regexes are case-insensitive
// to also cover that path.
const NORMALIZATION_CASES = [
  // Spanish → English canonicals
  { input: "evaluada", expected: "Evaluated", branch: "Spanish alias evaluada" },
  { input: "aplicado", expected: "Applied", branch: "Spanish alias aplicado" },
  { input: "enviada", expected: "Applied", branch: "Spanish alias enviada" },
  { input: "aplicada", expected: "Applied", branch: "Spanish alias aplicada" },
  { input: "sent", expected: "Applied", branch: "English alias sent" },
  { input: "respondido", expected: "Responded", branch: "Spanish alias respondido" },
  { input: "entrevista", expected: "Interview", branch: "Spanish alias entrevista" },
  { input: "oferta", expected: "Offer", branch: "Spanish alias oferta" },
  { input: "rechazada", expected: "Rejected", branch: "Spanish rechazada regex" },
  // Note: plain "rechazado" (no trailing date) is NOT handled by this script —
  // the regex on L43 is `/^rechazada?$/i` (matches "rechazad" or "rechazada"
  // only). Asserted as a known gap in the "cross-script inconsistency"
  // describe block below.
  { input: "descartada", expected: "Discarded", branch: "Spanish descartada regex" },
  { input: "descartado", expected: "Discarded", branch: "Spanish descartado regex" },
  { input: "cerrada", expected: "Discarded", branch: "Spanish cerrada → Discarded" },
  { input: "cancelada", expected: "Discarded", branch: "Spanish cancelada → Discarded" },
  // SKIP family
  { input: "no aplicar", expected: "SKIP", branch: "no aplicar → SKIP" },
  { input: "no_aplicar", expected: "SKIP", branch: "no_aplicar → SKIP" },
  // Conditional / hold family → Evaluated
  { input: "condicional", expected: "Evaluated", branch: "condicional regex" },
  { input: "hold", expected: "Evaluated", branch: "hold regex" },
  { input: "evaluar", expected: "Evaluated", branch: "evaluar regex" },
  { input: "verificar", expected: "Evaluated", branch: "verificar regex" },
  // Casing / bold (canonical reached via lower-cased compare)
  { input: "EVALUATED", expected: "Evaluated", branch: "casing fold to canonical" },
  { input: "**Applied**", expected: "Applied", branch: "markdown-bold strip" },
];

describe("normalize-statuses.mjs — alias → canonical table", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  for (const { input, expected, branch } of NORMALIZATION_CASES) {
    it(`maps "${input}" → "${expected}" (${branch})`, () => {
      const f = makeFixture({ rawStatus: input });
      fixtures.push(f);
      const r = f.runDry();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      // The script logs: `#<num>: "<old>" → "<new>"`
      // We assert the new value appears in the rewrite line for row #1.
      assert.match(
        r.stdout,
        new RegExp(`#1:.*→ "${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
        `expected rewrite to "${expected}" in:\n${r.stdout}`,
      );
      assert.match(r.stdout, /\(dry-run — no changes written\)/);
    });
  }
});

// Round-trip: every canonical English label, when already canonical, should
// be a no-op (no rewrite line, "No changes needed" footer).
const CANONICAL_LABELS = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
  "SKIP",
];

describe("normalize-statuses.mjs — canonical labels round-trip (no-op)", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  for (const label of CANONICAL_LABELS) {
    it(`"${label}" round-trips unchanged`, () => {
      const f = makeFixture({ rawStatus: label });
      fixtures.push(f);
      const r = f.runDry();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.doesNotMatch(
        r.stdout,
        /#1:.*→/,
        `unexpected rewrite for canonical "${label}":\n${r.stdout}`,
      );
      assert.match(r.stdout, /0 statuses normalized/);
    });
  }
});

describe("normalize-statuses.mjs — non-alias branches", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("DUPLICADO → Discarded and original is moved to notes", () => {
    const f = makeFixture({ rawStatus: "DUPLICADO #42", notes: "existing note" });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    const apps = f.readApps();
    assert.match(apps, /\| Discarded \|/);
    // moveToNotes prepends the raw "DUPLICADO #42" before the existing note.
    assert.match(apps, /DUPLICADO #42\. existing note/);
  });

  it("Repost #N → Discarded and original is moved to notes", () => {
    const f = makeFixture({ rawStatus: "Repost #99", notes: "orig" });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    const apps = f.readApps();
    assert.match(apps, /\| Discarded \|/);
    assert.match(apps, /Repost #99\. orig/);
  });

  it("Aplicado with trailing date → Applied (date stripped)", () => {
    const f = makeFixture({ rawStatus: "Aplicado 2026-01-15" });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /#1:.*→ "Applied"/);
  });

  it("Rechazado with trailing date → Rejected (date stripped)", () => {
    const f = makeFixture({ rawStatus: "Rechazado 2026-01-15" });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /#1:.*→ "Rejected"/);
  });

  it("MONITOR → SKIP", () => {
    const f = makeFixture({ rawStatus: "MONITOR" });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /#1:.*→ "SKIP"/);
  });

  it("'GEO BLOCKER' (any whitespace variant) → SKIP", () => {
    const f = makeFixture({ rawStatus: "GEO BLOCKER" });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /#1:.*→ "SKIP"/);
  });

  it("em-dash placeholder '—' → Discarded", () => {
    const f = makeFixture({ rawStatus: "—" });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /#1:.*→ "Discarded"/);
  });

  it("hyphen placeholder '-' → Discarded", () => {
    const f = makeFixture({ rawStatus: "-" });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /#1:.*→ "Discarded"/);
  });

  it("unknown status is flagged, not silently rewritten", () => {
    const f = makeFixture({ rawStatus: "Frobnicated" });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /unknown statuses/);
    assert.match(r.stdout, /"Frobnicated"/);
  });

  it("plain 'rechazado' is reported as unknown (gap — see PR takeaways)", () => {
    // verify-pipeline.mjs lists 'rechazado' as a Rejected alias, but the
    // regex in normalize-statuses.mjs only catches 'rechazada' or
    // 'rechazado <date>'. This test pins the current (inconsistent)
    // behavior so any fix must also update the assertion.
    const f = makeFixture({ rawStatus: "rechazado" });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /unknown statuses/);
    assert.match(r.stdout, /"rechazado"/);
  });

  it("writes a .bak before mutating data/applications.md", () => {
    const f = makeFixture({ rawStatus: "evaluada" });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /backup: applications\.md\.bak/);
    // The .bak should sit next to the file the script actually edits.
    const bak = readFileSync(join(f.dir, "data/applications.md.bak"), "utf-8");
    assert.match(bak, /\| evaluada \|/, "backup must contain pre-normalize content");
  });
});
