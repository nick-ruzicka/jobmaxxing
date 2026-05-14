/**
 * Integration tests for Task A — BuiltIn → ATS enrichment-time auto-promotion.
 *
 * Exercises the full flow:
 *   1. extractApplyUrl() pulls an ATS URL from JD HTML
 *   2. processRolePromotion() decides whether to promote based on apply_url +
 *      sourceHost + fit_score
 *   3. companies.yml + auto-promotion log get the right entries (or correctly
 *      don't, in the negative cases)
 *
 * These are unit-level integration tests — they don't run enrich-roles.mjs
 * itself (which would require a live Anthropic API key), but they exercise the
 * exact same call sequence enrich-roles.mjs runs after a successful enrichment.
 *
 * Cross-reference: scripts/enrich-roles.mjs main() loop and
 * scripts/lib/promote-company.mjs processRolePromotion().
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { extractApplyUrl } from "./apply-url-extractor.mjs";
import {
  processRolePromotion,
  createPromotionRunState,
  PROMOTION_CAP_PER_RUN,
  MIN_FIT_SCORE_FOR_PROMOTION,
} from "./promote-company.mjs";
import { writeCompaniesFile, readCompaniesFile } from "./companies-load.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "enrich-time-promo-test-"));
}

/** Realistic-shaped BuiltIn page HTML with a JSON-LD JobPosting + an Ashby apply link. */
function builtInPageHtml({ ashbyUrl, orgName = "Hebbia", title = "GTM Engineer" }) {
  return `
    <!DOCTYPE html>
    <html><head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      "title": "${title}",
      "hiringOrganization": {
        "@type": "Organization",
        "name": "${orgName}",
        "sameAs": "https://www.${orgName.toLowerCase()}.ai"
      },
      "datePosted": "2026-05-14"
    }
    </script>
    </head><body>
    <main>
      <h1>${title} at ${orgName}</h1>
      <a class="apply-btn" href="${ashbyUrl}">Apply on ${orgName}'s site</a>
    </main>
    </body></html>
  `;
}

/** Generic non-ATS company-careers page (control case). */
function genericCareersHtml(title = "GTM Engineer") {
  return `
    <html><body>
      <h1>${title}</h1>
      <a href="https://company.com/careers/${title.toLowerCase().replace(/\s/g, "-")}">Apply</a>
    </body></html>
  `;
}

// ---------------------------------------------------------------------------
// Fixture 1: BuiltIn → Ashby, fit_score above floor → SHOULD promote
// ---------------------------------------------------------------------------

test("enrich-time fixture 1: BuiltIn role w/ Ashby apply_url + fit>=floor → promotes", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const builtinUrl = "https://builtin.com/job/gtm-engineer-hebbia/123";
    const ashbyUrl = "https://jobs.ashbyhq.com/hebbia-ai/role-abc";
    const rawHtml = builtInPageHtml({ ashbyUrl, orgName: "Hebbia" });

    // What enrich-roles.mjs does:
    const apply = extractApplyUrl(rawHtml);
    assert.equal(apply, ashbyUrl, "extractor should find the Ashby URL");

    const runState = createPromotionRunState();
    const result = processRolePromotion({
      url: apply,
      sourceHost: "builtin.com",
      canonicalName: "Hebbia",
      fitScore: 7,
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
      foundViaUrl: builtinUrl,
    });

    assert.equal(result.action, "promoted");
    assert.equal(result.entry.ats, "ashby");
    assert.equal(result.entry.slug, "hebbia-ai");
    assert.equal(result.entry.source, "auto_promoted_from_builtin");

    // companies.yml should now have the entry.
    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].slug, "hebbia-ai");

    // JSONL log line should include the new provenance fields.
    const today = new Date().toISOString().slice(0, 10);
    const logPath = join(logDir, `${today}.jsonl`);
    assert.ok(existsSync(logPath), "promotion log file should exist");
    const line = readFileSync(logPath, "utf-8").trim().split("\n").pop();
    const entry = JSON.parse(line);
    assert.equal(entry.found_via, "builtin");
    assert.equal(entry.found_via_url, builtinUrl);
    assert.equal(entry.resolved_apply_url, ashbyUrl);
    assert.equal(entry.fit_score_at_promotion, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixture 2: BuiltIn → company.com/careers (non-ATS) → SHOULD NOT promote
// ---------------------------------------------------------------------------

test("enrich-time fixture 2: BuiltIn role w/ non-ATS apply URL → does NOT promote", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const rawHtml = genericCareersHtml("GTM Engineer");

    // The extractor returns null because nothing in the HTML is a recognized ATS URL.
    const apply = extractApplyUrl(rawHtml);
    assert.equal(apply, null, "no ATS URL → extractor returns null");

    // If enrich-roles.mjs gets null, it doesn't even call processRolePromotion.
    // But to harden the negative path, simulate a caller that passes the
    // non-ATS URL through anyway:
    const runState = createPromotionRunState();
    const result = processRolePromotion({
      url: "https://company.com/careers/gtm-engineer",
      sourceHost: "builtin.com",
      canonicalName: "SomeCompany",
      fitScore: 7,
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
    });
    assert.equal(result.action, "skipped");
    assert.equal(result.reason, "url-not-ats");

    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixture 3: fit_score below MIN_FIT_SCORE_FOR_PROMOTION → SHOULD NOT promote
// ---------------------------------------------------------------------------

test("enrich-time fixture 3: fit_score below floor → does NOT promote", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const builtinUrl = "https://builtin.com/job/junk-role/999";
    const ashbyUrl = "https://jobs.ashbyhq.com/lowfit-co/some-role";

    // Use a fit score one below the documented floor — should reject.
    const belowFloor = MIN_FIT_SCORE_FOR_PROMOTION - 1;
    assert.ok(belowFloor >= 1, "test prereq: floor must be > 1");

    const runState = createPromotionRunState();
    const result = processRolePromotion({
      url: ashbyUrl,
      sourceHost: "builtin.com",
      canonicalName: "LowFit Co",
      fitScore: belowFloor,
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
      foundViaUrl: builtinUrl,
    });
    assert.equal(result.action, "skipped");
    assert.equal(result.reason, "fit-score-too-low");

    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixture 4: slug already in companies.yml → SHOULD NOT re-promote
// ---------------------------------------------------------------------------

test("enrich-time fixture 4: already-tracked slug → does NOT re-promote", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    const existing = [{
      canonical_name: "Hebbia",
      ats: "ashby",
      slug: "hebbia-ai",
      source: "manual",
      added_date: "2026-05-10",
    }];
    writeCompaniesFile(existing, compPath);

    const runState = createPromotionRunState();
    const result = processRolePromotion({
      url: "https://jobs.ashbyhq.com/hebbia-ai/another-role",
      sourceHost: "builtin.com",
      canonicalName: "Hebbia",
      fitScore: 8,
      existingCompanies: existing,
      runState,
      companiesPath: compPath,
      logDir,
      foundViaUrl: "https://builtin.com/job/another-role/789",
    });
    assert.equal(result.action, "skipped");
    assert.equal(result.reason, "already-tracked");

    // companies.yml should be unchanged (still 1 entry).
    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixture 5: per-run cap → overflow promotions SHOULD be skipped
// ---------------------------------------------------------------------------

test("enrich-time fixture 5: per-run cap holds — overflow promotions are skipped", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const runState = createPromotionRunState();
    // Push the cap by one — every input is a fresh slug with fit above floor.
    const flood = PROMOTION_CAP_PER_RUN + 1;
    let promoted = 0;
    let cappedSkips = 0;
    let existing = [];
    for (let i = 0; i < flood; i++) {
      const slug = `flood-co-${i.toString().padStart(3, "0")}`;
      const result = processRolePromotion({
        url: `https://jobs.ashbyhq.com/${slug}/role`,
        sourceHost: "builtin.com",
        canonicalName: `Flood Co ${i}`,
        fitScore: 7,
        existingCompanies: existing,
        runState,
        companiesPath: compPath,
        logDir,
        foundViaUrl: `https://builtin.com/job/flood-${i}/abc`,
      });
      if (result.action === "promoted") {
        promoted++;
        existing = [...existing, result.entry];
      } else if (result.action === "capped") {
        cappedSkips++;
      }
    }
    assert.equal(promoted, PROMOTION_CAP_PER_RUN, "exactly cap-many should promote");
    assert.equal(cappedSkips, 1, "exactly one overflow should be capped");
    assert.equal(runState.capped, true, "runState.capped should be flagged");

    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, PROMOTION_CAP_PER_RUN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Extra sanity check: the full extractor → promotion sequence end-to-end
// ---------------------------------------------------------------------------

test("enrich-time end-to-end: BuiltIn HTML → extractor → promotion writes correct fields", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const builtinUrl = "https://builtin.com/job/senior-engineer-relace/456";
    const ashbyUrl = "https://jobs.ashbyhq.com/relace/posting-xyz";
    const rawHtml = builtInPageHtml({ ashbyUrl, orgName: "Relace", title: "Senior Engineer" });

    const apply = extractApplyUrl(rawHtml);
    assert.equal(apply, ashbyUrl);

    const runState = createPromotionRunState();
    const result = processRolePromotion({
      url: apply,
      sourceHost: "builtin.com",
      canonicalName: "Relace",
      fitScore: 9,
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
      foundViaUrl: builtinUrl,
    });

    assert.equal(result.action, "promoted");

    // Verify the JSONL log has all three new provenance fields.
    const today = new Date().toISOString().slice(0, 10);
    const log = readFileSync(join(logDir, `${today}.jsonl`), "utf-8").trim();
    const entry = JSON.parse(log);
    assert.equal(entry.ats, "ashby");
    assert.equal(entry.slug, "relace");
    assert.equal(entry.found_via, "builtin");
    assert.equal(entry.found_via_url, builtinUrl, "found_via_url is the BuiltIn URL");
    assert.equal(entry.resolved_apply_url, ashbyUrl, "resolved_apply_url is the Ashby URL");
    assert.equal(entry.fit_score_at_promotion, 9);
    assert.equal(entry.source_url, ashbyUrl, "source_url remains the trigger URL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
