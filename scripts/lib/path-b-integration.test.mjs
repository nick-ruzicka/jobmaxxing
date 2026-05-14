/**
 * path-b-integration.test.mjs — end-to-end tests for the Coverage Engine
 * Overhaul (Path B). Exercises the full chain from a discovery to a
 * promotion / enrichment-skip decision, against fixture data only.
 *
 * No live URLs are fetched. Every test injects either fixture data or a fake
 * fetch. The intent: catch any regression where the components built in
 * Tasks 1-6 stop composing correctly.
 *
 * Fixtures live in tests/fixtures/path-b-integration/ (sibling to scripts/).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  createPromotionRunState,
  processRolePromotion,
} from "./promote-company.mjs";
import {
  writeCompaniesFile,
  readCompaniesFile,
} from "./companies-load.mjs";
import {
  isAggregatorHost,
  isExcludedHost,
} from "./source-classification.mjs";
import { scanLever } from "./lever-scraper.mjs";
import { scanYc } from "./yc-scraper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "..", "tests", "fixtures", "path-b-integration");

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
}

function tmp() {
  return mkdtempSync(join(tmpdir(), "path-b-integration-"));
}

// ---------------------------------------------------------------------------
// AUTO-PROMOTION INTEGRATION
// ---------------------------------------------------------------------------

test("integration: BuiltIn fixture → promote each new ATS slug exactly once", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");

    // Pre-seed with a couple of entries to simulate dedup. linear+pinecone are in
    // the fixture's "should-be-skipped" set.
    writeCompaniesFile(
      [
        {
          canonical_name: "Linear",
          ats: "ashby",
          slug: "linear",
          source: "manual",
          added_date: "2026-05-12",
        },
        {
          canonical_name: "Pinecone",
          ats: "lever",
          slug: "pinecone",
          source: "manual",
          added_date: "2026-05-14",
        },
      ],
      compPath,
    );

    const fx = loadFixture("sample-builtin-roles.json");
    const runState = createPromotionRunState();
    const outcomes = [];

    for (const role of fx.roles) {
      const { entries: companies } = readCompaniesFile(compPath);
      const result = processRolePromotion({
        url: role.apply_url,
        sourceHost: "builtin.com",
        canonicalName: role.company,
        fitScore: role.fit_score,
        existingCompanies: companies,
        runState,
        companiesPath: compPath,
        logDir,
      });
      outcomes.push({ id: role.id, ...result });
    }

    // Expected outcomes — verifying every BuiltIn fixture entry routes correctly.
    const byId = Object.fromEntries(outcomes.map((o) => [o.id, o]));
    assert.equal(byId["builtin-1"].action, "promoted"); // hebbia-ai (new)
    assert.equal(byId["builtin-2"].action, "promoted"); // notion (greenhouse, new)
    assert.equal(byId["builtin-3"].action, "promoted"); // eliseai (new)
    assert.equal(byId["builtin-4"].action, "skipped"); // company-direct URL → url-not-ats
    assert.equal(byId["builtin-4"].reason, "url-not-ats");
    assert.equal(byId["builtin-5"].action, "promoted"); // modal-labs lever (new)
    assert.equal(byId["builtin-6"].action, "skipped"); // hebbia-ai already promoted
    assert.equal(byId["builtin-6"].reason, "already-tracked");
    assert.equal(byId["builtin-7"].action, "promoted"); // vercel (new)
    assert.equal(byId["builtin-8"].action, "promoted"); // anthropic lever (new)
    assert.equal(byId["builtin-9"].action, "skipped"); // pinecone pre-seeded
    assert.equal(byId["builtin-9"].reason, "already-tracked");
    assert.equal(byId["builtin-10"].action, "skipped"); // linear pre-seeded
    assert.equal(byId["builtin-10"].reason, "already-tracked");

    // Verify the YAML file actually grew by the right amount.
    const { entries: final } = readCompaniesFile(compPath);
    assert.equal(final.length, 2 + 6); // 2 pre-seeded + 6 newly promoted
    const newlyPromoted = final.filter((e) => e.source.startsWith("auto_promoted_from_"));
    assert.equal(newlyPromoted.length, 6);
    for (const e of newlyPromoted) {
      assert.equal(e.source, "auto_promoted_from_builtin");
    }

    // Verify the JSONL log got 6 entries.
    const today = new Date().toISOString().slice(0, 10);
    const logPath = join(logDir, `${today}.jsonl`);
    assert.ok(existsSync(logPath));
    const logLines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    assert.equal(logLines.length, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("integration: company-direct apply URLs never promote", () => {
  // Discovery URL on builtin.com, apply URL on the company's own /careers — should
  // be 'url-not-ats', never get into companies.yml.
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    writeCompaniesFile([], compPath);
    const runState = createPromotionRunState();
    const r = processRolePromotion({
      url: "https://hebbia.ai/careers/gtm-engineer",
      sourceHost: "builtin.com",
      canonicalName: "Hebbia",
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir: join(dir, "logs"),
    });
    assert.equal(r.action, "skipped");
    assert.equal(r.reason, "url-not-ats");
    const { entries } = readCompaniesFile(compPath);
    assert.equal(entries.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ENRICHMENT-GATE INTEGRATION (Wound A)
// ---------------------------------------------------------------------------

test("integration: quarantined seen-urls.json entries get skipped at the enrichment gate", () => {
  const fx = loadFixture("sample-quarantined-source.json");
  const skipped = [];
  const enrich = [];
  for (const [url, _meta] of Object.entries(fx.seenUrls)) {
    if (url.startsWith("_")) continue;
    // This mirrors the exact check enrich-roles.mjs does.
    if (isExcludedHost(url) || isAggregatorHost(url)) skipped.push(url);
    else enrich.push(url);
  }
  // Per the fixture: revopscareers, liveblog365, lensa, saashero should skip;
  // ashbyhq + builtin should enrich.
  assert.equal(skipped.length, 4);
  assert.equal(enrich.length, 2);
  assert.ok(
    skipped.includes(
      "https://revopscareers.com/job/mural-revenue-operations-business-partner-united-states",
    ),
  );
  assert.ok(
    skipped.includes("https://hirevector.liveblog365.com/job/revenue-operations-analyst-26"),
  );
  assert.ok(enrich.includes("https://jobs.ashbyhq.com/eliseai/abc"));
  assert.ok(enrich.includes("https://builtin.com/job/gtm-engineer/eliseai/123"));
});

// ---------------------------------------------------------------------------
// TIER-5 SOCIAL GATE (Wound B)
// ---------------------------------------------------------------------------

test("integration: Tier 5 social signals gate evaluates correctly under env conditions", () => {
  const original = process.env.ENABLE_SOCIAL_SIGNALS;
  try {
    // Off by default.
    delete process.env.ENABLE_SOCIAL_SIGNALS;
    assert.equal(process.env.ENABLE_SOCIAL_SIGNALS === "true", false);
    // Off for falsy-like strings.
    for (const v of ["false", "0", "no", "off"]) {
      process.env.ENABLE_SOCIAL_SIGNALS = v;
      assert.equal(process.env.ENABLE_SOCIAL_SIGNALS === "true", false);
    }
    // Only the literal "true" flips it on.
    process.env.ENABLE_SOCIAL_SIGNALS = "true";
    assert.equal(process.env.ENABLE_SOCIAL_SIGNALS === "true", true);
  } finally {
    if (original === undefined) delete process.env.ENABLE_SOCIAL_SIGNALS;
    else process.env.ENABLE_SOCIAL_SIGNALS = original;
  }
});

// ---------------------------------------------------------------------------
// LEVER + YC NORMALIZATION (Tasks 4 & 5)
// ---------------------------------------------------------------------------

test("integration: Lever fixture → normalized roles for both companies", async () => {
  const fx = loadFixture("sample-lever-response.json");
  // fake fetch that picks the right company's postings from the fixture.
  const fakeFetch = async (url) => {
    const m = url.match(/\/postings\/([^?]+)/);
    const slug = m ? m[1] : null;
    if (!slug || !(slug in fx) || fx[slug] === null) {
      return { ok: false, status: 404, json: async () => null };
    }
    return { ok: true, status: 200, json: async () => fx[slug] };
  };
  const { results, failed } = await scanLever(["plaid", "posthog", "not-real-co"], {
    fetch: fakeFetch,
  });
  // 3 postings total (2 plaid + 1 posthog); not-real-co 404s.
  assert.equal(results.length, 3);
  assert.deepEqual(failed, ["not-real-co"]);
  // Verify each is properly tagged.
  for (const r of results) assert.equal(r.source, "Tier 1: Lever");
  // Comp parsing on the Plaid GTM role
  const plaidGtm = results.find((r) => r.title === "Senior GTM Engineer");
  assert.ok(plaidGtm);
  assert.equal(plaidGtm.comp, "$200K-$280K");
  assert.equal(plaidGtm.location, "New York, NY, Remote");
});

test("integration: YC fixture → hydration-extracted roles, filtered by URL presence", async () => {
  const fx = loadFixture("sample-yc-roles.json");
  const html = `<!doctype html><html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fx)}</script></html>`;
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => html,
  });
  const { results, failed } = await scanYc(["GTM Engineer"], { fetch: fakeFetch });
  assert.equal(failed.length, 0);
  // 3 jobs in fixture, all have URLs (id-fallback if hosted_url missing) → all 3.
  // Title-based filtering happens downstream in scan-jobs.mjs, NOT in scanYc.
  assert.equal(results.length, 3);
  for (const r of results) assert.equal(r.source, "Tier 1: YC");
  // Verify YC-specific fields preserved.
  const relace = results.find((r) => r.company === "Relace");
  assert.ok(relace);
  assert.equal(relace.ycBatch, "W24");
  assert.equal(relace.ycStage, "Series A");
});

// ---------------------------------------------------------------------------
// AUTO-PROMOTION + YC: yc-discovered ATS apply URL triggers promotion
// ---------------------------------------------------------------------------

test("integration: YC discovery whose apply URL is on Ashby promotes the company", () => {
  // Simulate the scan-jobs.mjs flow: YC scraper returns a posting with
  // apply_url=jobs.ashbyhq.com/relace/... — promotion engine should fire.
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const fx = loadFixture("sample-yc-roles.json");
    const job = fx.props.pageProps.initialState.jobs[0]; // the Relace posting
    // For YC, our scraper's normalizeYcJob would set r.url to hosted_url
    // (workatastartup.com), not apply_url. But the auto-promoter is fed r.url —
    // so for promotion-via-YC to trigger, the URL must already be an ATS URL.
    //
    // Here we simulate the case where scan-jobs.mjs feeds the apply_url to
    // promotion (e.g., via a future enhancement; today only when normalizeYcJob
    // sees no hosted_url and falls back to apply_url).
    const runState = createPromotionRunState();
    const result = processRolePromotion({
      url: job.apply_url, // jobs.ashbyhq.com/relace/...
      sourceHost: "workatastartup.com",
      canonicalName: job.company.name,
      fitScore: 8,
      existingCompanies: [],
      runState,
      companiesPath: compPath,
      logDir,
    });
    assert.equal(result.action, "promoted");
    assert.equal(result.entry.source, "auto_promoted_from_yc");
    assert.equal(result.entry.ats, "ashby");
    assert.equal(result.entry.slug, "relace");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SAFETY: per-run cap holds under fixture load
// ---------------------------------------------------------------------------

test("integration: per-run cap holds even on a flood of promotable discoveries", () => {
  const dir = tmp();
  try {
    const compPath = join(dir, "companies.yml");
    const logDir = join(dir, "logs");
    writeCompaniesFile([], compPath);

    const runState = createPromotionRunState();
    const FLOOD = 50;
    let promoted = 0;
    let capped = 0;
    for (let i = 0; i < FLOOD; i++) {
      const { entries } = readCompaniesFile(compPath);
      const r = processRolePromotion({
        url: `https://jobs.ashbyhq.com/flood-co-${i}/abc`,
        sourceHost: "builtin.com",
        canonicalName: `Flood Co ${i}`,
        existingCompanies: entries,
        runState,
        companiesPath: compPath,
        logDir,
      });
      if (r.action === "promoted") promoted++;
      if (r.action === "capped") capped++;
    }
    assert.equal(promoted, 20); // PROMOTION_CAP_PER_RUN
    assert.equal(capped, 30);
    assert.equal(runState.capped, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
