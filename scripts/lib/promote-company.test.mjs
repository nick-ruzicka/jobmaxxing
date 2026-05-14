import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  shouldPromote,
  promoteCompany,
  processRolePromotion,
  createPromotionRunState,
  PROMOTION_CAP_PER_RUN,
} from "./promote-company.mjs";
import {
  writeCompaniesFile,
  readCompaniesFile,
} from "./companies-load.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "promote-company-test-"));
}

const baseEntry = {
  canonical_name: "EliseAI",
  ats: "ashby",
  slug: "eliseai",
  source: "manual",
  added_date: "2026-05-12",
};

// ---------------------------------------------------------------------------
// shouldPromote
// ---------------------------------------------------------------------------

test("shouldPromote — BuiltIn → Ashby URL, not yet tracked, returns promote=true", () => {
  const r = shouldPromote({
    url: "https://jobs.ashbyhq.com/hebbia-ai/abc-123",
    sourceHost: "builtin.com",
    existingCompanies: [],
    fitScore: 6,
  });
  assert.equal(r.promote, true);
  assert.equal(r.ats, "ashby");
  assert.equal(r.slug, "hebbia-ai");
});

test("shouldPromote — already-tracked entry skipped", () => {
  const r = shouldPromote({
    url: "https://jobs.ashbyhq.com/eliseai/abc",
    sourceHost: "builtin.com",
    existingCompanies: [baseEntry],
    fitScore: 6,
  });
  assert.equal(r.promote, false);
  assert.equal(r.reason, "already-tracked");
});

test("shouldPromote — non-ATS URL skipped", () => {
  const r = shouldPromote({
    url: "https://builtin.com/job/gtm-engineer/12345",
    sourceHost: "builtin.com",
    existingCompanies: [],
  });
  assert.equal(r.promote, false);
  assert.equal(r.reason, "url-not-ats");
});

test("shouldPromote — non-promotable source skipped", () => {
  const r = shouldPromote({
    url: "https://jobs.ashbyhq.com/plaid/123",
    sourceHost: "thesaraslist.com",
    existingCompanies: [],
  });
  assert.equal(r.promote, false);
  assert.equal(r.reason, "source-not-promotable");
});

test("shouldPromote — quarantined aggregator source rejected", () => {
  const r = shouldPromote({
    url: "https://jobs.ashbyhq.com/plaid/123",
    sourceHost: "revopscareers.com",
    existingCompanies: [],
  });
  assert.equal(r.promote, false);
  assert.equal(r.reason, "source-not-promotable");
});

test("shouldPromote — YC source allowed", () => {
  const r = shouldPromote({
    url: "https://jobs.lever.co/plaid/abc",
    sourceHost: "workatastartup.com",
    existingCompanies: [],
    fitScore: 7,
  });
  assert.equal(r.promote, true);
  assert.equal(r.ats, "lever");
  assert.equal(r.slug, "plaid");
});

test("shouldPromote — fit score below minimum rejects", () => {
  const r = shouldPromote({
    url: "https://jobs.ashbyhq.com/foo-co/abc",
    sourceHost: "builtin.com",
    existingCompanies: [],
    fitScore: 2,
  });
  assert.equal(r.promote, false);
  assert.equal(r.reason, "fit-score-too-low");
});

test("shouldPromote — fit score absent is OK (passes gate)", () => {
  const r = shouldPromote({
    url: "https://jobs.ashbyhq.com/foo-co/abc",
    sourceHost: "builtin.com",
    existingCompanies: [],
  });
  assert.equal(r.promote, true);
});

test("shouldPromote — custom minFitScore=6, score 5 rejects, score 6 passes", () => {
  const args = {
    url: "https://jobs.ashbyhq.com/foo-co/abc",
    sourceHost: "builtin.com",
    existingCompanies: [],
    minFitScore: 6,
  };
  assert.equal(shouldPromote({ ...args, fitScore: 5 }).promote, false);
  assert.equal(shouldPromote({ ...args, fitScore: 6 }).promote, true);
});

test("shouldPromote — same slug different ATS is NOT already-tracked", () => {
  // Hebbia is on both Ashby (as hebbia-ai) and Greenhouse (as hebbia). If we have
  // Ashby tracked and discover the Greenhouse URL, we should still promote it.
  const r = shouldPromote({
    url: "https://boards.greenhouse.io/hebbia",
    sourceHost: "builtin.com",
    existingCompanies: [{ ...baseEntry, ats: "ashby", slug: "hebbia-ai" }],
  });
  assert.equal(r.promote, true);
  assert.equal(r.ats, "greenhouse");
  assert.equal(r.slug, "hebbia");
});

test("shouldPromote — Built In Boston/SF/Chicago all promote-eligible", () => {
  for (const sh of ["builtinboston.com", "builtinchicago.org", "builtinsf.com"]) {
    const r = shouldPromote({
      url: "https://jobs.ashbyhq.com/foo-co/abc",
      sourceHost: sh,
      existingCompanies: [],
    });
    assert.equal(r.promote, true, `failed for sourceHost=${sh}`);
  }
});

// ---------------------------------------------------------------------------
// promoteCompany
// ---------------------------------------------------------------------------

test("promoteCompany — writes a new entry to companies.yml", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([baseEntry], compPath);
    const r = promoteCompany({
      ats: "ashby",
      slug: "hebbia-ai",
      canonicalName: "Hebbia",
      sourceUrl: "https://jobs.ashbyhq.com/hebbia-ai/abc",
      foundVia: "builtin",
      companiesPath: compPath,
      logDir,
    });
    assert.equal(r.wrote, true);
    assert.equal(r.entry.source, "auto_promoted_from_builtin");
    assert.equal(r.entry.canonical_name, "Hebbia");

    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, 2);
    const added = entries.find((e) => e.slug === "hebbia-ai");
    assert.ok(added);
    assert.equal(added.source, "auto_promoted_from_builtin");
    assert.match(added.added_date, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("promoteCompany — refuses to double-write same (ats, slug)", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    writeCompaniesFile([baseEntry], compPath);
    const r = promoteCompany({
      ats: "ashby",
      slug: "eliseai", // already in baseEntry
      canonicalName: "EliseAI",
      sourceUrl: "https://jobs.ashbyhq.com/eliseai/abc",
      foundVia: "builtin",
      companiesPath: compPath,
      logDir: join(dir, "logs"),
    });
    assert.equal(r.wrote, false);
    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("promoteCompany — writes a JSONL line to data/auto-promotions/<date>.jsonl", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);
    promoteCompany({
      ats: "lever",
      slug: "modal-labs",
      canonicalName: "Modal Labs",
      sourceUrl: "https://jobs.lever.co/modal-labs/abc",
      foundVia: "builtin",
      companiesPath: compPath,
      logDir,
    });
    const today = new Date().toISOString().slice(0, 10);
    const logPath = join(logDir, `${today}.jsonl`);
    assert.ok(existsSync(logPath));
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.ats, "lever");
    assert.equal(obj.slug, "modal-labs");
    assert.equal(obj.found_via, "builtin");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("promoteCompany — rejects unsupported ats", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    writeCompaniesFile([], compPath);
    assert.throws(
      () =>
        promoteCompany({
          ats: "workday",
          slug: "foo",
          canonicalName: "Foo",
          companiesPath: compPath,
          logDir: join(dir, "logs"),
        }),
      /unsupported ats/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// processRolePromotion (integration)
// ---------------------------------------------------------------------------

test("processRolePromotion — happy path: promote a single discovery", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const runState = createPromotionRunState();
    const result = processRolePromotion({
      url: "https://jobs.ashbyhq.com/hebbia-ai/abc",
      sourceHost: "builtin.com",
      canonicalName: "Hebbia",
      fitScore: 7,
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
    });
    assert.equal(result.action, "promoted");
    assert.equal(runState.promotionsThisRun, 1);
    assert.equal(runState.capped, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("processRolePromotion — per-run cap halts further promotions", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const runState = createPromotionRunState();
    runState.promotionsThisRun = PROMOTION_CAP_PER_RUN; // pre-load to cap

    const result = processRolePromotion({
      url: "https://jobs.ashbyhq.com/new-co/abc",
      sourceHost: "builtin.com",
      canonicalName: "NewCo",
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
    });
    assert.equal(result.action, "capped");
    assert.equal(runState.capped, true);
    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("processRolePromotion — many calls respect cap", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const runState = createPromotionRunState();
    let promoted = 0;
    let capped = 0;
    for (let i = 0; i < PROMOTION_CAP_PER_RUN + 5; i++) {
      const r = processRolePromotion({
        url: `https://jobs.ashbyhq.com/co-${i}/abc`,
        sourceHost: "builtin.com",
        canonicalName: `Co ${i}`,
        existingCompanies: [],
        runState,
        companiesPath: compPath,
        logDir,
      });
      if (r.action === "promoted") promoted++;
      if (r.action === "capped") capped++;
    }
    assert.equal(promoted, PROMOTION_CAP_PER_RUN);
    assert.equal(capped, 5);
    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, PROMOTION_CAP_PER_RUN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("processRolePromotion — non-ATS URL returns skipped, doesn't count against cap", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const runState = createPromotionRunState();
    const result = processRolePromotion({
      url: "https://builtin.com/job/gtm-engineer/123",
      sourceHost: "builtin.com",
      canonicalName: "SomeCo",
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
    });
    assert.equal(result.action, "skipped");
    assert.equal(result.reason, "url-not-ats");
    assert.equal(runState.promotionsThisRun, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("processRolePromotion — idempotent: re-running same URL is a no-op", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const runState = createPromotionRunState();
    const url = "https://jobs.lever.co/plaid/abc";

    const r1 = processRolePromotion({
      url,
      sourceHost: "workatastartup.com",
      canonicalName: "Plaid",
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
    });
    assert.equal(r1.action, "promoted");

    // Re-read companies to simulate the next iteration of the scrape loop.
    const { entries: now } = readCompaniesFile(compPath);
    const r2 = processRolePromotion({
      url,
      sourceHost: "workatastartup.com",
      canonicalName: "Plaid",
      existingCompanies: now,
      runState,
      companiesPath: compPath,
      logDir,
    });
    assert.equal(r2.action, "skipped");
    assert.equal(r2.reason, "already-tracked");
    assert.equal(runState.promotionsThisRun, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
