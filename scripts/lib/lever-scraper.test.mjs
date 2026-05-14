import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLeverJob,
  fetchLeverCompany,
  scanLever,
} from "./lever-scraper.mjs";

const SAMPLE_JOB = {
  id: "abc-123",
  text: "Senior GTM Engineer",
  hostedUrl: "https://jobs.lever.co/plaid/abc-123",
  applyUrl: "https://jobs.lever.co/plaid/abc-123/apply",
  categories: {
    team: "Revenue",
    location: "New York, NY",
    commitment: "Full-time",
    department: "Revenue",
    allLocations: ["New York, NY", "Remote"],
  },
  createdAt: 1714425600000, // 2024-04-29T22:40:00Z
  workplaceType: "remote",
  salaryRange: { min: 180000, max: 240000, currency: "USD", interval: "per-year-salary" },
  descriptionPlain: "Build the revenue stack…",
};

function fakeFetch({ status = 200, body = null } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// ---------------------------------------------------------------------------
// normalizeLeverJob
// ---------------------------------------------------------------------------

test("normalizeLeverJob — happy path", () => {
  const r = normalizeLeverJob(SAMPLE_JOB, "plaid");
  assert.equal(r.title, "Senior GTM Engineer");
  assert.equal(r.company, "Plaid");
  assert.equal(r.url, "https://jobs.lever.co/plaid/abc-123");
  assert.ok(r.publishedDate.startsWith("2024-"));
  assert.equal(r.location, "New York, NY, Remote");
  assert.equal(r.workplaceType, "remote");
  assert.equal(r.team, "Revenue");
  assert.equal(r.source, "Tier 1: Lever");
  assert.equal(r.comp, "$180K-$240K");
  assert.equal(r.text, "Build the revenue stack…");
});

test("normalizeLeverJob — slug with dashes is title-cased", () => {
  const r = normalizeLeverJob({ ...SAMPLE_JOB }, "modal-labs");
  assert.equal(r.company, "Modal labs"); // (title-case "modal" + " " + "labs")
});

test("normalizeLeverJob — falls back to constructed URL if hostedUrl missing", () => {
  const r = normalizeLeverJob({ ...SAMPLE_JOB, hostedUrl: undefined }, "plaid");
  assert.equal(r.url, "https://jobs.lever.co/plaid/abc-123");
});

test("normalizeLeverJob — falls back to single location if allLocations absent", () => {
  const r = normalizeLeverJob(
    { ...SAMPLE_JOB, categories: { ...SAMPLE_JOB.categories, allLocations: undefined } },
    "plaid",
  );
  assert.equal(r.location, "New York, NY");
});

test("normalizeLeverJob — missing categories doesn't throw", () => {
  const r = normalizeLeverJob({ ...SAMPLE_JOB, categories: undefined }, "plaid");
  assert.equal(r.location, "");
  assert.equal(r.team, "");
});

test("normalizeLeverJob — empty salaryRange produces empty comp", () => {
  const r = normalizeLeverJob({ ...SAMPLE_JOB, salaryRange: undefined }, "plaid");
  assert.equal(r.comp, "");
});

test("normalizeLeverJob — invalid createdAt produces empty date", () => {
  const r = normalizeLeverJob({ ...SAMPLE_JOB, createdAt: "yesterday" }, "plaid");
  assert.equal(r.publishedDate, "");
});

test("normalizeLeverJob — null/undefined inputs handled", () => {
  const r = normalizeLeverJob({}, "plaid");
  assert.equal(r.title, "");
  assert.equal(r.url, "https://jobs.lever.co/plaid/");
});

// ---------------------------------------------------------------------------
// fetchLeverCompany
// ---------------------------------------------------------------------------

test("fetchLeverCompany — 200 returns jobs array", async () => {
  const f = fakeFetch({ status: 200, body: [SAMPLE_JOB] });
  const { jobs, error } = await fetchLeverCompany("plaid", { fetch: f });
  assert.equal(error, null);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "abc-123");
});

test("fetchLeverCompany — 404 tags error='404'", async () => {
  const f = fakeFetch({ status: 404, body: null });
  const { jobs, error } = await fetchLeverCompany("not-real-co", { fetch: f });
  assert.equal(error, "404");
  assert.deepEqual(jobs, []);
});

test("fetchLeverCompany — non-OK non-404 tags error", async () => {
  const f = fakeFetch({ status: 503, body: null });
  const { jobs, error } = await fetchLeverCompany("plaid", { fetch: f });
  assert.equal(error, "http-503");
  assert.deepEqual(jobs, []);
});

test("fetchLeverCompany — non-array body tags 'parse'", async () => {
  const f = fakeFetch({ status: 200, body: { error: "oops" } });
  const { jobs, error } = await fetchLeverCompany("plaid", { fetch: f });
  assert.equal(error, "parse");
});

test("fetchLeverCompany — thrown fetch tags 'network'", async () => {
  const f = async () => {
    throw new Error("ECONNREFUSED");
  };
  const { jobs, error } = await fetchLeverCompany("plaid", { fetch: f });
  assert.equal(error, "network");
  assert.deepEqual(jobs, []);
});

// ---------------------------------------------------------------------------
// scanLever
// ---------------------------------------------------------------------------

test("scanLever — scans all slugs, accumulates jobs, tracks 404s", async () => {
  let n = 0;
  const f = async (url) => {
    n++;
    if (url.includes("/not-real-co")) {
      return { ok: false, status: 404, json: async () => null };
    }
    return { ok: true, status: 200, json: async () => [SAMPLE_JOB] };
  };
  const { results, failed, checked } = await scanLever(
    ["plaid", "posthog", "not-real-co"],
    { fetch: f },
  );
  assert.equal(checked, 3);
  assert.equal(n, 3);
  assert.deepEqual(failed, ["not-real-co"]);
  assert.equal(results.length, 2);
  assert.equal(results[0].source, "Tier 1: Lever");
});

test("scanLever — skips jobs with no title", async () => {
  const f = fakeFetch({
    status: 200,
    body: [
      { ...SAMPLE_JOB, text: "" },
      SAMPLE_JOB,
    ],
  });
  const { results } = await scanLever(["plaid"], { fetch: f });
  assert.equal(results.length, 1);
});

test("scanLever — empty slug list returns empty results", async () => {
  const { results, failed, checked } = await scanLever([]);
  assert.equal(results.length, 0);
  assert.equal(failed.length, 0);
  assert.equal(checked, 0);
});

test("scanLever — passes timeout to fetchLeverCompany without crashing", async () => {
  const f = fakeFetch({ status: 200, body: [] });
  const { results } = await scanLever(["plaid"], { fetch: f, timeoutMs: 5000 });
  assert.deepEqual(results, []);
});
