// Tests for the pipeline-integrity health check (`verify-pipeline.mjs`).
//
// `verify-pipeline.mjs` lives at the repo root and is a CLI script with no
// exports — it reads `data/applications.md` (or root `applications.md`) and
// `batch/tracker-additions/` relative to its own `import.meta.url`, then
// process.exit's 0/1 depending on whether it found errors.
//
// Fixture strategy (matching `dashboard-web/lib/data.test.ts`): create a
// temp dir, COPY `verify-pipeline.mjs` into it so the script's
// `dirname(fileURLToPath(import.meta.url))` resolves to our fixture root,
// populate `data/applications.md` + `reports/*` + `batch/tracker-additions/*`
// inside the temp dir, then `spawnSync('node', [<copied script>])` and
// assert on exit code + stdout. Each `it()` block names the specific check
// (numbered 1–7 in the script) that the row exercises so reviewers can map
// coverage back to the code under test.
//
// What is NOT covered:
// - The `STATES_FILE` constant on lines 28–30 is computed but never read by
//   the script — there is nothing to test there until the script actually
//   consumes states.yml. Flagged in the PR takeaways.
// - The header comment claims a "duplicate URL" check; the actual check is
//   company+role (no URL column exists in applications.md). Tests assert
//   the implemented behavior, not the docstring.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_SRC = join(REPO_ROOT, "verify-pipeline.mjs");

const HEADER = [
  "# Applications Tracker",
  "",
  "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
  "|---|------|---------|------|-------|--------|-----|--------|-------|",
].join("\n");

/**
 * Build a temp fixture: copy verify-pipeline.mjs into it, write
 * data/applications.md, optionally seed reports/ and pending TSVs.
 * Returns { run(), dir, cleanup() }.
 */
function makeFixture({
  applicationsMd,
  appsAtRoot = false,
  reports = [],
  pendingTsvs = [],
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-pipeline-"));
  copyFileSync(SCRIPT_SRC, join(dir, "verify-pipeline.mjs"));

  if (applicationsMd !== undefined) {
    if (appsAtRoot) {
      writeFileSync(join(dir, "applications.md"), applicationsMd);
    } else {
      mkdirSync(join(dir, "data"), { recursive: true });
      writeFileSync(join(dir, "data/applications.md"), applicationsMd);
    }
  }

  if (reports.length > 0) {
    mkdirSync(join(dir, "reports"), { recursive: true });
    for (const name of reports) {
      writeFileSync(join(dir, "reports", name), "# stub report\n");
    }
  }

  if (pendingTsvs.length > 0) {
    mkdirSync(join(dir, "batch/tracker-additions"), { recursive: true });
    for (const { name, content } of pendingTsvs) {
      writeFileSync(join(dir, "batch/tracker-additions", name), content);
    }
  }

  return {
    dir,
    run() {
      return spawnSync("node", [join(dir, "verify-pipeline.mjs")], {
        encoding: "utf-8",
      });
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function row({
  num,
  date = "2026-01-15",
  company,
  role,
  score = "4.5/5",
  status = "Evaluated",
  pdf = "✅",
  report,
  notes = "First eval",
}) {
  return `| ${num} | ${date} | ${company} | ${role} | ${score} | ${status} | ${pdf} | ${report} | ${notes} |`;
}

describe("verify-pipeline.mjs — happy path", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("returns exit 0 when applications.md is missing (fresh-setup branch)", () => {
    const f = makeFixture({});
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /No applications\.md found/);
  });

  it("returns exit 0 on a clean tracker with one canonical row", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        report: "[1](reports/001-acme-2026-01-15.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["001-acme-2026-01-15.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Pipeline is clean/);
    assert.match(r.stdout, /All statuses are canonical/);
    assert.match(r.stdout, /All report links valid/);
    assert.match(r.stdout, /All scores valid/);
  });

  it("reads from root-level applications.md when data/applications.md is absent", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        report: "[1](reports/001-acme-2026-01-15.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      appsAtRoot: true,
      reports: ["001-acme-2026-01-15.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Pipeline is clean/);
  });
});

describe("verify-pipeline.mjs — Check 1 (canonical statuses)", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("flags a status that is neither canonical nor an alias (exit 1)", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        status: "Bogus",
        report: "[1](reports/001-acme-2026-01-15.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["001-acme-2026-01-15.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Non-canonical status "Bogus"/);
  });

  it("flags markdown bold in status field (exit 1)", () => {
    const apps = [
      HEADER,
      row({
        num: 2,
        company: "Acme",
        role: "Engineer",
        status: "**Evaluated**",
        report: "[2](reports/002-acme-2026-01-15.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["002-acme-2026-01-15.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Status contains markdown bold/);
  });

  it("flags a date inside the status field (exit 1)", () => {
    const apps = [
      HEADER,
      row({
        num: 3,
        company: "Acme",
        role: "Engineer",
        status: "Applied 2026-01-15",
        report: "[3](reports/003-acme-2026-01-15.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["003-acme-2026-01-15.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Status contains date/);
  });

  it("accepts Spanish aliases (evaluada, aplicado, …) as canonical-equivalent", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Uno",
        role: "Eng",
        status: "evaluada",
        report: "[1](reports/001.md)",
      }),
      row({
        num: 2,
        company: "Dos",
        role: "Eng",
        status: "aplicado",
        report: "[2](reports/002.md)",
      }),
      row({
        num: 3,
        company: "Tres",
        role: "Eng",
        status: "entrevista",
        report: "[3](reports/003.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["001.md", "002.md", "003.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /All statuses are canonical/);
  });
});

describe("verify-pipeline.mjs — Check 2 (company+role duplicates)", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("warns (but does not error) on two rows with the same company+role", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        report: "[1](reports/001.md)",
      }),
      row({
        num: 2,
        company: "Acme",
        role: "Engineer",
        report: "[2](reports/002.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["001.md", "002.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 0); // warnings only
    assert.match(r.stdout, /Possible duplicates: #1, #2/);
    assert.match(r.stdout, /Pipeline OK with warnings/);
  });
});

describe("verify-pipeline.mjs — Check 3 (broken report links)", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("errors when a report markdown link points to a missing file (exit 1)", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        report: "[1](reports/does-not-exist.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: [], // intentionally absent
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Report not found: reports\/does-not-exist\.md/);
  });
});

describe("verify-pipeline.mjs — Check 4 (score format)", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("errors on a score that does not match /5, N/A, or DUP (exit 1)", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        score: "great",
        report: "[1](reports/001.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["001.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Invalid score format/);
  });

  it("accepts N/A and DUP as score sentinels", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        score: "N/A",
        report: "[1](reports/001.md)",
      }),
      row({
        num: 2,
        company: "Acme",
        role: "Engineer Sr",
        score: "DUP",
        report: "[2](reports/002.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["001.md", "002.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /All scores valid/);
  });
});

describe("verify-pipeline.mjs — Check 5 (row format)", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("errors when a non-header table row has fewer than 9 columns (exit 1)", () => {
    // The pipe-line counter excludes any line containing `---` or `Empresa`,
    // so we add a malformed row that contains neither.
    const apps = [HEADER, "| 99 | malformed |"].join("\n");
    const f = makeFixture({ applicationsMd: apps });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Row with <9 columns/);
  });
});

describe("verify-pipeline.mjs — Check 6 (pending TSVs in tracker-additions)", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("warns when un-merged TSVs sit in batch/tracker-additions/ (exit 0)", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        report: "[1](reports/001.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["001.md"],
      pendingTsvs: [
        { name: "pending-1.tsv", content: "1\t2026-01-15\tAcme\tEng\tEvaluated\t4.5/5\t✅\t[1](reports/001.md)\tnote" },
      ],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /1 pending TSVs in tracker-additions\/ \(not merged\)/);
  });
});

describe("verify-pipeline.mjs — Check 7 (markdown bold in score)", () => {
  const fixtures = [];
  after(() => fixtures.forEach((f) => f.cleanup()));

  it("warns on markdown bold inside the score field (exit 0)", () => {
    const apps = [
      HEADER,
      row({
        num: 1,
        company: "Acme",
        role: "Engineer",
        score: "**4.5/5**",
        report: "[1](reports/001.md)",
      }),
    ].join("\n");
    const f = makeFixture({
      applicationsMd: apps,
      reports: ["001.md"],
    });
    fixtures.push(f);
    const r = f.run();
    assert.equal(r.status, 0); // warning only
    assert.match(r.stdout, /Score has markdown bold/);
  });
});
