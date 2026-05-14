import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAshbySlug,
  extractGreenhouseSlug,
  extractLeverSlug,
  extractAtsInfo,
  SUPPORTED_ATS,
} from "./ats-slug-extractor.mjs";

// ---------------------------------------------------------------------------
// Ashby
// ---------------------------------------------------------------------------

test("extractAshbySlug — public job-board root", () => {
  assert.equal(extractAshbySlug("https://jobs.ashbyhq.com/eliseai"), "eliseai");
});

test("extractAshbySlug — public job-board with job id", () => {
  assert.equal(
    extractAshbySlug("https://jobs.ashbyhq.com/eliseai/7a74322c-415a-41cb-8956-ee170d3bb267"),
    "eliseai",
  );
});

test("extractAshbySlug — application path", () => {
  assert.equal(
    extractAshbySlug("https://jobs.ashbyhq.com/eliseai/7a74322c/application"),
    "eliseai",
  );
});

test("extractAshbySlug — trailing slash", () => {
  assert.equal(extractAshbySlug("https://jobs.ashbyhq.com/eliseai/"), "eliseai");
});

test("extractAshbySlug — query string", () => {
  assert.equal(
    extractAshbySlug("https://jobs.ashbyhq.com/eliseai/abc-123?source=builtin&utm_source=foo"),
    "eliseai",
  );
});

test("extractAshbySlug — www prefix", () => {
  assert.equal(extractAshbySlug("https://www.jobs.ashbyhq.com/eliseai"), "eliseai");
});

test("extractAshbySlug — slug with dashes (modal-labs style)", () => {
  assert.equal(extractAshbySlug("https://jobs.ashbyhq.com/hebbia-ai/123"), "hebbia-ai");
});

test("extractAshbySlug — API form", () => {
  assert.equal(
    extractAshbySlug("https://api.ashbyhq.com/posting-api/job-board/eliseai"),
    "eliseai",
  );
});

test("extractAshbySlug — API with includeCompensation param", () => {
  assert.equal(
    extractAshbySlug(
      "https://api.ashbyhq.com/posting-api/job-board/eliseai?includeCompensation=true",
    ),
    "eliseai",
  );
});

test("extractAshbySlug — bare host returns null (no slug to extract)", () => {
  assert.equal(extractAshbySlug("https://jobs.ashbyhq.com"), null);
  assert.equal(extractAshbySlug("https://jobs.ashbyhq.com/"), null);
});

test("extractAshbySlug — non-Ashby hostname returns null", () => {
  assert.equal(extractAshbySlug("https://boards.greenhouse.io/eliseai"), null);
  assert.equal(extractAshbySlug("https://builtin.com/job/x"), null);
});

test("extractAshbySlug — malformed URL", () => {
  assert.equal(extractAshbySlug("not a url"), null);
  assert.equal(extractAshbySlug(""), null);
  assert.equal(extractAshbySlug(null), null);
  assert.equal(extractAshbySlug(undefined), null);
});

test("extractAshbySlug — rejects reserved path segments", () => {
  // /jobs as first segment is a reserved word, not a company slug.
  assert.equal(extractAshbySlug("https://jobs.ashbyhq.com/jobs/foo"), null);
  // /board /apply etc.
  assert.equal(extractAshbySlug("https://jobs.ashbyhq.com/api/foo"), null);
});

test("extractAshbySlug — uppercase normalizes to lowercase", () => {
  assert.equal(extractAshbySlug("https://jobs.ashbyhq.com/EliseAI/abc"), "eliseai");
});

// ---------------------------------------------------------------------------
// Greenhouse
// ---------------------------------------------------------------------------

test("extractGreenhouseSlug — boards.greenhouse.io", () => {
  assert.equal(extractGreenhouseSlug("https://boards.greenhouse.io/hebbia"), "hebbia");
});

test("extractGreenhouseSlug — with /jobs/<id> path", () => {
  assert.equal(
    extractGreenhouseSlug("https://boards.greenhouse.io/hebbia/jobs/5918855004"),
    "hebbia",
  );
});

test("extractGreenhouseSlug — job-boards.greenhouse.io (newer)", () => {
  assert.equal(
    extractGreenhouseSlug("https://job-boards.greenhouse.io/apolloio/jobs/5918855004"),
    "apolloio",
  );
});

test("extractGreenhouseSlug — boards-api.greenhouse.io", () => {
  assert.equal(
    extractGreenhouseSlug("https://boards-api.greenhouse.io/v1/boards/hebbia/jobs"),
    "hebbia",
  );
});

test("extractGreenhouseSlug — query string with gh_jid", () => {
  assert.equal(
    extractGreenhouseSlug("https://boards.greenhouse.io/hebbia?gh_jid=12345"),
    "hebbia",
  );
});

test("extractGreenhouseSlug — bare host returns null", () => {
  assert.equal(extractGreenhouseSlug("https://boards.greenhouse.io"), null);
  assert.equal(extractGreenhouseSlug("https://boards.greenhouse.io/"), null);
});

test("extractGreenhouseSlug — non-Greenhouse host returns null", () => {
  assert.equal(extractGreenhouseSlug("https://jobs.ashbyhq.com/hebbia"), null);
});

test("extractGreenhouseSlug — embed page", () => {
  // boards.greenhouse.io/embed/job_board?for=<slug> — not currently handled; the slug
  // is in the query string. Documenting current behavior: returns null.
  assert.equal(
    extractGreenhouseSlug("https://boards.greenhouse.io/embed/job_board?for=hebbia"),
    null,
  );
});

// ---------------------------------------------------------------------------
// Lever
// ---------------------------------------------------------------------------

test("extractLeverSlug — jobs.lever.co/<slug>", () => {
  assert.equal(extractLeverSlug("https://jobs.lever.co/plaid"), "plaid");
});

test("extractLeverSlug — jobs.lever.co/<slug>/<posting-id>", () => {
  assert.equal(
    extractLeverSlug("https://jobs.lever.co/plaid/abc-123-def"),
    "plaid",
  );
});

test("extractLeverSlug — apply path", () => {
  assert.equal(
    extractLeverSlug("https://jobs.lever.co/plaid/abc-123/apply"),
    "plaid",
  );
});

test("extractLeverSlug — api.lever.co", () => {
  assert.equal(
    extractLeverSlug("https://api.lever.co/v0/postings/plaid"),
    "plaid",
  );
});

test("extractLeverSlug — api.lever.co with mode=json", () => {
  assert.equal(
    extractLeverSlug("https://api.lever.co/v0/postings/plaid?mode=json"),
    "plaid",
  );
});

test("extractLeverSlug — slug with dashes", () => {
  assert.equal(
    extractLeverSlug("https://jobs.lever.co/modal-labs/abc-123"),
    "modal-labs",
  );
});

test("extractLeverSlug — bare host returns null", () => {
  assert.equal(extractLeverSlug("https://jobs.lever.co"), null);
});

test("extractLeverSlug — non-Lever host returns null", () => {
  assert.equal(extractLeverSlug("https://jobs.ashbyhq.com/plaid"), null);
});

// ---------------------------------------------------------------------------
// extractAtsInfo (composite)
// ---------------------------------------------------------------------------

test("extractAtsInfo — returns ashby+slug for Ashby URL", () => {
  assert.deepEqual(extractAtsInfo("https://jobs.ashbyhq.com/eliseai/abc"), {
    ats: "ashby",
    slug: "eliseai",
  });
});

test("extractAtsInfo — returns greenhouse+slug for GH URL", () => {
  assert.deepEqual(extractAtsInfo("https://boards.greenhouse.io/hebbia/jobs/123"), {
    ats: "greenhouse",
    slug: "hebbia",
  });
});

test("extractAtsInfo — returns lever+slug for Lever URL", () => {
  assert.deepEqual(extractAtsInfo("https://jobs.lever.co/plaid/abc"), {
    ats: "lever",
    slug: "plaid",
  });
});

test("extractAtsInfo — non-ATS URL returns null/null", () => {
  assert.deepEqual(extractAtsInfo("https://builtin.com/job/gtm-engineer-eliseai/123"), {
    ats: null,
    slug: null,
  });
  assert.deepEqual(extractAtsInfo("https://workatastartup.com/jobs/12345"), {
    ats: null,
    slug: null,
  });
});

test("extractAtsInfo — malformed URL returns null/null", () => {
  assert.deepEqual(extractAtsInfo("not a url"), { ats: null, slug: null });
  assert.deepEqual(extractAtsInfo(null), { ats: null, slug: null });
});

test("SUPPORTED_ATS matches the schema constant", async () => {
  // Defensive: this list must stay in sync with companies-schema.mjs SUPPORTED_ATS.
  const { SUPPORTED_ATS: schemaAts } = await import("./companies-schema.mjs");
  assert.deepEqual([...SUPPORTED_ATS].sort(), [...schemaAts].sort());
});
