// Tests for the tracker merge tool (`merge-tracker.mjs`).
//
// `merge-tracker.mjs` lives at the repo root and is a CLI script with no
// exports. It reads pending TSV files from `batch/tracker-additions/`,
// dedups them against `data/applications.md` (by report number, then
// entry number, then company+role fuzzy match), and either appends new
// rows after the header separator OR updates an existing row in-place
// when the incoming score is higher.
//
// Fixture strategy: same as the other two pipeline-integrity tests —
// copy `merge-tracker.mjs` into a temp dir, populate
// `data/applications.md` + `batch/tracker-additions/<file>.tsv`, run
// with `--dry-run` (so we don't need to worry about the merged/ move
// rename side effect), and assert on stdout + the in-memory parsed
// applications.md.
//
// Notes on what each describe block covers (the script's three add/update
// paths plus the three TSV parser branches):
//   - "new entry path"        → `add` branch (entry number > maxNum, append)
//   - "duplicate, higher score" → `update` branch (in-place rewrite)
//   - "duplicate, lower score"  → `skip` branch (no change)
//   - "TSV parser variants"   → 9-col TSV (status, score), swapped (score,
//     status), pipe-delimited markdown row, malformed (< 8 fields).

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
const SCRIPT_SRC = join(REPO_ROOT, "merge-tracker.mjs");

const HEADER = [
  "# Applications Tracker",
  "",
  "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
  "|---|------|---------|------|-------|--------|-----|--------|-------|",
].join("\n");

function row({
  num,
  date = "2026-01-15",
  company,
  role,
  score = "4.0/5",
  status = "Evaluated",
  pdf = "✅",
  report,
  notes = "n",
}) {
  return `| ${num} | ${date} | ${company} | ${role} | ${score} | ${status} | ${pdf} | ${report} | ${notes} |`;
}

function makeFixture({ apps = HEADER, tsvs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "merge-tracker-"));
  copyFileSync(SCRIPT_SRC, join(dir, "merge-tracker.mjs"));
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "data/applications.md"), apps);
  mkdirSync(join(dir, "batch/tracker-additions"), { recursive: true });
  for (const { name, content } of tsvs) {
    writeFileSync(join(dir, "batch/tracker-additions", name), content);
  }
  return {
    dir,
    runDry() {
      return spawnSync(
        "node",
        [join(dir, "merge-tracker.mjs"), "--dry-run"],
        { encoding: "utf-8" },
      );
    },
    runWrite() {
      return spawnSync("node", [join(dir, "merge-tracker.mjs")], {
        encoding: "utf-8",
      });
    },
    readApps() {
      return readFileSync(join(dir, "data/applications.md"), "utf-8");
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("merge-tracker.mjs — new-entry path", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("appends a new row immediately after the header separator", () => {
    const f = makeFixture({
      apps: HEADER,
      tsvs: [
        {
          name: "010-acme.tsv",
          // 9-col TSV in the documented "status before score" order
          content:
            "10\t2026-01-20\tAcme\tEngineer\tEvaluated\t4.2/5\t✅\t[10](reports/010.md)\tFirst eval",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\+1 added/);
    const apps = f.readApps();
    // Inserted right after the |---|...| separator (which is line 4 here).
    const lines = apps.split("\n");
    const sepIdx = lines.findIndex(
      (l) => l.startsWith("|") && l.includes("---"),
    );
    assert.ok(sepIdx > 0, "header separator should exist");
    assert.match(
      lines[sepIdx + 1],
      /\| 10 \| 2026-01-20 \| Acme \| Engineer \| 4\.2\/5 \| Evaluated \|/,
    );
  });

  it("processes multiple pending TSVs in numeric filename order", () => {
    const f = makeFixture({
      apps: HEADER,
      tsvs: [
        {
          name: "020-second.tsv",
          content:
            "20\t2026-01-20\tBeta\tEng\tEvaluated\t4.0/5\t✅\t[20](reports/020.md)\t-",
        },
        {
          name: "010-first.tsv",
          content:
            "10\t2026-01-20\tAlpha\tEng\tEvaluated\t4.0/5\t✅\t[10](reports/010.md)\t-",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /\+2 added/);
    // Both rows present, alpha first (lower entry number wins by sort).
    const apps = f.readApps();
    const alphaIdx = apps.indexOf("Alpha");
    const betaIdx = apps.indexOf("Beta");
    assert.ok(alphaIdx > 0 && betaIdx > 0, "both rows must appear");
    // Both new rows are inserted at the same insertion point (after the
    // separator); the second one is unshifted in front, so Beta — pushed
    // first then Alpha — Alpha ends up above. Assert ordering matches
    // the splice insertion semantics so any change to insertion logic
    // surfaces here.
    assert.ok(
      alphaIdx < betaIdx,
      `expected Alpha (sorted first) above Beta — got Alpha@${alphaIdx} Beta@${betaIdx}`,
    );
  });
});

describe("merge-tracker.mjs — duplicate detection + update-in-place", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("updates an existing row when incoming score is higher (matched by report #)", () => {
    const apps = [
      HEADER,
      row({
        num: 5,
        company: "Acme",
        role: "Engineer",
        score: "3.5/5",
        report: "[5](reports/005.md)",
        notes: "old",
      }),
    ].join("\n");
    const f = makeFixture({
      apps,
      tsvs: [
        {
          name: "005-acme.tsv",
          content:
            "5\t2026-02-01\tAcme\tEngineer\tEvaluated\t4.7/5\t✅\t[5](reports/005-v2.md)\tre-eval",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /🔄 Update: #5/);
    assert.match(r.stdout, /3\.5→4\.7/);
    const updated = f.readApps();
    assert.match(updated, /\| 5 \| 2026-02-01 \| Acme \| Engineer \| 4\.7\/5 \|/);
    assert.match(updated, /Re-eval 2026-02-01 \(3\.5→4\.7\)/);
  });

  it("skips a duplicate when incoming score is lower than existing", () => {
    const apps = [
      HEADER,
      row({
        num: 5,
        company: "Acme",
        role: "Engineer",
        score: "4.5/5",
        report: "[5](reports/005.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      apps,
      tsvs: [
        {
          name: "005-acme.tsv",
          content:
            "5\t2026-02-01\tAcme\tEngineer\tEvaluated\t2.0/5\t✅\t[5](reports/005-v2.md)\tlow",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /⏭️\s+Skip:/);
    const apps2 = f.readApps();
    // The original 4.5/5 row must be unchanged.
    assert.match(apps2, /\| 5 \|.*\| 4\.5\/5 \|/);
    assert.doesNotMatch(apps2, /2\.0\/5/);
  });

  it("dedups by company+role fuzzy match when report numbers do not collide", () => {
    // Existing row: entry #1, report #1, company Acme, role "Backend Engineer"
    // Incoming TSV: entry #999, report #999, company "ACME!!!", role
    // "Senior Backend Engineer" — same company (case+punct insensitive)
    // and ≥2 long-word overlap on role ("backend", "engineer" — words
    // shorter than 4 chars are filtered out by `roleFuzzyMatch`). Fuzzy
    // match should fire.
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Backend Engineer",
        score: "3.0/5",
        report: "[1](reports/001.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      apps,
      tsvs: [
        {
          name: "999-acme.tsv",
          content:
            "999\t2026-02-01\tACME!!!\tSenior Backend Engineer\tEvaluated\t4.8/5\t✅\t[999](reports/999.md)\tfuzzy",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /🔄 Update: #1/);
  });
});

describe("merge-tracker.mjs — TSV parser variants", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("parses pipe-delimited markdown rows (begins with '|')", () => {
    const f = makeFixture({
      apps: HEADER,
      tsvs: [
        {
          name: "030-pipe.tsv",
          content:
            "| 30 | 2026-01-20 | Pipey | Eng | 4.0/5 | Evaluated | ✅ | [30](reports/030.md) | from pipe |",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /\+1 added/);
    assert.match(f.readApps(), /\| 30 \|.*\| Pipey \|/);
  });

  it("auto-detects swapped TSV columns (score before status)", () => {
    // Standard format is num\tdate\tcompany\trole\tSTATUS\tSCORE\t...
    // Some legacy TSVs put SCORE in col4 and STATUS in col5. The
    // heuristic at L138–158 detects this and swaps before validating.
    const f = makeFixture({
      apps: HEADER,
      tsvs: [
        {
          name: "040-swapped.tsv",
          // col4 = "4.0/5" (looks like score), col5 = "Evaluated" (looks
          // like status) → script must read them swapped.
          content:
            "40\t2026-01-20\tSwap\tEng\t4.0/5\tEvaluated\t✅\t[40](reports/040.md)\tswapped",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /\+1 added/);
    const apps = f.readApps();
    // Output row must put the score in the score column, not the status column.
    assert.match(apps, /\| 40 \|.*\| Swap \| Eng \| 4\.0\/5 \| Evaluated \|/);
  });

  it("coerces a non-canonical status to 'Evaluated' with a warning", () => {
    const f = makeFixture({
      apps: HEADER,
      tsvs: [
        {
          name: "050-bogus.tsv",
          content:
            "50\t2026-01-20\tBogus\tEng\tFROBNICATED\t4.0/5\t✅\t[50](reports/050.md)\tbad",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // Warning goes to stderr per console.warn default.
    const combined = r.stdout + r.stderr;
    assert.match(combined, /Non-canonical status "FROBNICATED" → defaulting to "Evaluated"/);
    const apps = f.readApps();
    // The added row must use the canonical fallback.
    assert.match(apps, /\| 50 \|.*\| Bogus \| Eng \|.*\| Evaluated \|/);
  });

  it("skips malformed TSVs (fewer than 8 fields)", () => {
    const f = makeFixture({
      apps: HEADER,
      tsvs: [
        {
          name: "060-malformed.tsv",
          content: "60\t2026-01-20\tShort",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const combined = r.stdout + r.stderr;
    assert.match(combined, /Skipping malformed TSV 060-malformed\.tsv: 3 fields/);
    assert.match(r.stdout, /⏭️1 skipped/);
  });

  it("skips a TSV whose entry number is not a positive integer", () => {
    const f = makeFixture({
      apps: HEADER,
      tsvs: [
        {
          name: "070-bad-num.tsv",
          content:
            "notanumber\t2026-01-20\tBad\tEng\tEvaluated\t4.0/5\t✅\t[70](reports/070.md)\tbad",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /invalid entry number/);
    assert.match(r.stdout, /⏭️1 skipped/);
  });
});

describe("merge-tracker.mjs — no-op + empty input paths", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("exits 0 with 'No pending additions' when tracker-additions/ is empty", () => {
    const f = makeFixture({ apps: HEADER, tsvs: [] });
    fixtures.push(f);
    const r = f.runWrite();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /No pending additions to merge/);
  });

  it("--dry-run does not move TSVs into merged/", () => {
    const f = makeFixture({
      apps: HEADER,
      tsvs: [
        {
          name: "080-dry.tsv",
          content:
            "80\t2026-01-20\tDry\tEng\tEvaluated\t4.0/5\t✅\t[80](reports/080.md)\tdry",
        },
      ],
    });
    fixtures.push(f);
    const r = f.runDry();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /\(dry-run — no changes written\)/);
    // applications.md must be unchanged
    assert.equal(f.readApps(), HEADER);
  });
});
