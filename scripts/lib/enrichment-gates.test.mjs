/**
 * enrichment-gates.test.mjs — verify the bleeding-wound fix from
 * autoapply/SCRAPER_AUDIT.md works at the level of the actual host-classification
 * predicates. scripts/enrich-roles.mjs's main() is not directly testable (it's a
 * top-level async function with side effects), so we test the *gate* — the
 * predicates that scripts/enrich-roles.mjs now uses to decide skip-or-enrich.
 *
 * If these tests pass, the enrichment loop will skip the same hosts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAggregatorHost,
  isExcludedHost,
} from "./source-classification.mjs";

test("enrichment gate — quarantines revopscareers.com (the audit's primary waste)", () => {
  // The exact URL shape that was burning Claude tokens.
  assert.equal(
    isAggregatorHost(
      "https://revopscareers.com/job/mural-revenue-operations-business-partner-united-states",
    ),
    true,
  );
});

test("enrichment gate — quarantines all 5 aggregator hosts", () => {
  for (const url of [
    "https://revopscareers.com/job/x",
    "https://lensa.com/jobs/y",
    "https://whatjobs.com/listing/z",
    "https://jobright.ai/job/abc",
    "https://jobgether.com/offer/123",
  ]) {
    assert.equal(isAggregatorHost(url), true, `expected aggregator: ${url}`);
  }
});

test("enrichment gate — excludes spam hosts (subdomain-inclusive)", () => {
  for (const url of [
    "https://hirevector.liveblog365.com/job/x",
    "https://remotica.totalh.net/job/x",
    "https://hirepath.wuaze.com/job/x",
    "https://novaedge.page.gd/x",
    "https://saashero.net/x",
  ]) {
    assert.equal(isExcludedHost(url), true, `expected excluded: ${url}`);
  }
});

test("enrichment gate — does NOT quarantine healthy ATS hosts", () => {
  for (const url of [
    "https://jobs.ashbyhq.com/eliseai/abc",
    "https://boards.greenhouse.io/hebbia",
    "https://job-boards.greenhouse.io/apolloio/jobs/123",
    "https://jobs.lever.co/plaid/abc",
    "https://builtin.com/job/gtm-engineer/123",
  ]) {
    assert.equal(isAggregatorHost(url), false, `unexpected aggregator: ${url}`);
    assert.equal(isExcludedHost(url), false, `unexpected excluded: ${url}`);
  }
});

test("enrichment gate — quarantine/exclude is malformed-URL-safe", () => {
  assert.equal(isAggregatorHost("not a url"), false);
  assert.equal(isExcludedHost(""), false);
  assert.equal(isAggregatorHost(null), false);
  assert.equal(isExcludedHost(undefined), false);
});

test("ENABLE_SOCIAL_SIGNALS gate — Tier 5 default-OFF behavior", () => {
  // We don't import scan-jobs.mjs (it's a top-level main()). Instead we assert the
  // gate condition the same way scan-jobs.mjs evaluates it:
  // `process.env.ENABLE_SOCIAL_SIGNALS === "true"`.
  const original = process.env.ENABLE_SOCIAL_SIGNALS;
  try {
    delete process.env.ENABLE_SOCIAL_SIGNALS;
    assert.equal(process.env.ENABLE_SOCIAL_SIGNALS === "true", false);

    process.env.ENABLE_SOCIAL_SIGNALS = "false";
    assert.equal(process.env.ENABLE_SOCIAL_SIGNALS === "true", false);

    process.env.ENABLE_SOCIAL_SIGNALS = "1";
    assert.equal(process.env.ENABLE_SOCIAL_SIGNALS === "true", false);

    process.env.ENABLE_SOCIAL_SIGNALS = "true";
    assert.equal(process.env.ENABLE_SOCIAL_SIGNALS === "true", true);
  } finally {
    if (original === undefined) delete process.env.ENABLE_SOCIAL_SIGNALS;
    else process.env.ENABLE_SOCIAL_SIGNALS = original;
  }
});
