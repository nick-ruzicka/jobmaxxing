import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeYcJob,
  extractYcHydration,
  findJobsInHydration,
  fetchYcSearch,
  scanYc,
} from "./yc-scraper.mjs";

// ---------------------------------------------------------------------------
// normalizeYcJob
// ---------------------------------------------------------------------------

test("normalizeYcJob — happy path with full posting", () => {
  const job = {
    id: 12345,
    title: "GTM Engineer",
    company: { name: "Relace", batch: "W24", stage: "Series A" },
    hosted_url: "https://www.workatastartup.com/jobs/12345",
    location: "New York, NY",
    work_type: "hybrid",
    salary_min: 160000,
    salary_max: 220000,
    description: "<p>Build the GTM stack…</p>",
    created_at: "2026-05-01T00:00:00Z",
  };
  const r = normalizeYcJob(job);
  assert.equal(r.title, "GTM Engineer");
  assert.equal(r.company, "Relace");
  assert.equal(r.url, "https://www.workatastartup.com/jobs/12345");
  assert.equal(r.location, "New York, NY");
  assert.equal(r.workplaceType, "hybrid");
  assert.equal(r.comp, "$160K-$220K");
  assert.equal(r.text, "Build the GTM stack…");
  assert.equal(r.source, "Tier 1: YC");
  assert.equal(r.ycBatch, "W24");
  assert.equal(r.ycStage, "Series A");
});

test("normalizeYcJob — missing optional fields don't throw", () => {
  const job = { id: 9, title: "GTM Engineer", company: { name: "FooCo" } };
  const r = normalizeYcJob(job);
  assert.equal(r.title, "GTM Engineer");
  assert.equal(r.company, "FooCo");
  assert.equal(r.url, "https://www.workatastartup.com/jobs/9");
  assert.equal(r.comp, "");
});

test("normalizeYcJob — missing title returns null (filtered upstream)", () => {
  assert.equal(normalizeYcJob({ id: 1, company: { name: "X" } }), null);
  assert.equal(normalizeYcJob({ id: 1, title: "", company: { name: "X" } }), null);
});

test("normalizeYcJob — apply_url fallback when hosted_url missing", () => {
  const r = normalizeYcJob({
    id: 1,
    title: "X",
    company: { name: "Y" },
    apply_url: "https://example.com/apply/1",
  });
  assert.equal(r.url, "https://example.com/apply/1");
});

test("normalizeYcJob — locations array flattened", () => {
  const r = normalizeYcJob({
    id: 1,
    title: "X",
    company: { name: "Y" },
    locations: ["NYC", "Remote"],
  });
  assert.equal(r.location, "NYC, Remote");
});

test("normalizeYcJob — remote: true → workplaceType remote", () => {
  const r = normalizeYcJob({
    id: 1,
    title: "X",
    company: { name: "Y" },
    remote: true,
  });
  assert.equal(r.workplaceType, "remote");
});

test("normalizeYcJob — salary_range string preserved", () => {
  const r = normalizeYcJob({
    id: 1,
    title: "X",
    company: { name: "Y" },
    salary_range: "$120K-$160K + 0.1% equity",
  });
  assert.equal(r.comp, "$120K-$160K + 0.1% equity");
});

test("normalizeYcJob — null/undefined inputs return null", () => {
  assert.equal(normalizeYcJob(null), null);
  assert.equal(normalizeYcJob(undefined), null);
  assert.equal(normalizeYcJob("not a job"), null);
});

// ---------------------------------------------------------------------------
// extractYcHydration
// ---------------------------------------------------------------------------

test("extractYcHydration — Next.js __NEXT_DATA__ pattern", () => {
  const payload = { props: { pageProps: { jobs: [] } } };
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
  assert.deepEqual(extractYcHydration(html), payload);
});

test("extractYcHydration — alternate server_data pattern", () => {
  const payload = { jobs: [{ id: 1, title: "X", company: { name: "Y" } }] };
  const html = `<script id="server_data">${JSON.stringify(payload)}</script>`;
  assert.deepEqual(extractYcHydration(html), payload);
});

test("extractYcHydration — invalid JSON returns null", () => {
  const html = `<script id="__NEXT_DATA__">{ "props": broken json }</script>`;
  assert.equal(extractYcHydration(html), null);
});

test("extractYcHydration — no script tag returns null", () => {
  assert.equal(extractYcHydration("<html><body>hi</body></html>"), null);
  assert.equal(extractYcHydration(""), null);
  assert.equal(extractYcHydration(null), null);
});

// ---------------------------------------------------------------------------
// findJobsInHydration
// ---------------------------------------------------------------------------

test("findJobsInHydration — finds postings array nested deep", () => {
  const payload = {
    props: {
      pageProps: {
        initialState: {
          jobs: [
            { id: 1, title: "GTM Engineer", company: { name: "Relace" } },
            { id: 2, title: "Revenue Engineer", company_id: 99 },
          ],
        },
      },
    },
  };
  const found = findJobsInHydration(payload);
  assert.equal(found.length, 2);
  assert.equal(found[0].title, "GTM Engineer");
});

test("findJobsInHydration — ignores arrays that don't look like jobs", () => {
  const payload = {
    metadata: { tags: ["a", "b", "c"] },
    config: [{ key: "x", value: 1 }],
    jobs: [{ id: 1, title: "Job", company: { name: "Co" } }],
  };
  const found = findJobsInHydration(payload);
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "Job");
});

test("findJobsInHydration — empty payload returns []", () => {
  assert.deepEqual(findJobsInHydration({}), []);
  assert.deepEqual(findJobsInHydration(null), []);
});

test("findJobsInHydration — circular-safe", () => {
  const a = { jobs: null };
  a.jobs = a; // circular reference
  // Should not throw or hang.
  assert.deepEqual(findJobsInHydration(a), []);
});

// ---------------------------------------------------------------------------
// fetchYcSearch
// ---------------------------------------------------------------------------

function fakeFetch({ status = 200, html = "" } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => html,
  });
}

test("fetchYcSearch — happy path parses hydration", async () => {
  const payload = {
    props: { pageProps: { jobs: [{ id: 1, title: "GTM Engineer", company: { name: "Relace" } }] } },
  };
  const html = `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`;
  const f = fakeFetch({ status: 200, html });
  const { jobs, error } = await fetchYcSearch("GTM Engineer", { fetch: f });
  assert.equal(error, null);
  assert.equal(jobs.length, 1);
});

test("fetchYcSearch — HTTP 503 tags error", async () => {
  const f = fakeFetch({ status: 503, html: "" });
  const { jobs, error } = await fetchYcSearch("GTM Engineer", { fetch: f });
  assert.equal(error, "http-503");
  assert.deepEqual(jobs, []);
});

test("fetchYcSearch — missing hydration tags 'no-hydration'", async () => {
  const f = fakeFetch({ status: 200, html: "<html>blank</html>" });
  const { jobs, error } = await fetchYcSearch("GTM Engineer", { fetch: f });
  assert.equal(error, "no-hydration");
});

test("fetchYcSearch — thrown fetch tags 'network'", async () => {
  const f = async () => {
    throw new Error("ECONNREFUSED");
  };
  const { error } = await fetchYcSearch("GTM Engineer", { fetch: f });
  assert.equal(error, "network");
});

// ---------------------------------------------------------------------------
// scanYc
// ---------------------------------------------------------------------------

test("scanYc — runs all queries, dedups cross-query results by URL", async () => {
  const job = { id: 1, title: "GTM Engineer", company: { name: "Relace" }, hosted_url: "https://www.workatastartup.com/jobs/1" };
  const payload = { props: { pageProps: { jobs: [job] } } };
  const html = `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`;
  // Both queries return the same job → dedup should leave 1
  const f = fakeFetch({ status: 200, html });
  const { results, failed, checked } = await scanYc(
    ["GTM Engineer", "Revenue Operations"],
    { fetch: f },
  );
  assert.equal(checked, 2);
  assert.equal(failed.length, 0);
  assert.equal(results.length, 1);
});

test("scanYc — empty queries returns empty results", async () => {
  const { results, failed, checked } = await scanYc([]);
  assert.equal(results.length, 0);
  assert.equal(failed.length, 0);
  assert.equal(checked, 0);
});

test("scanYc — collects per-query errors in `failed`", async () => {
  let n = 0;
  const f = async () => {
    n++;
    return { ok: n === 1, status: n === 1 ? 200 : 503, text: async () => `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { jobs: [] } } })}</script>` };
  };
  const { failed, checked } = await scanYc(["q1", "q2"], { fetch: f });
  assert.equal(checked, 2);
  assert.equal(failed.length, 1);
  assert.match(failed[0], /q2/);
  assert.match(failed[0], /http-503/);
});

test("scanYc — skips jobs with no URL", async () => {
  const payload = {
    props: {
      pageProps: {
        jobs: [
          { id: 1, title: "X", company: { name: "C" }, hosted_url: "" },
          { title: "Y", company: { name: "D" } }, // no id, no urls — skipped
          { id: 2, title: "Z", company: { name: "E" }, hosted_url: "https://example.com/2" },
        ],
      },
    },
  };
  const html = `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`;
  const f = fakeFetch({ status: 200, html });
  const { results } = await scanYc(["q"], { fetch: f });
  // X has hosted_url="" but falls back to apply_url=undefined → falls back to id
  // → https://www.workatastartup.com/jobs/1 (valid). So 2 valid (X and Z), Y skipped.
  assert.equal(results.length, 2);
});
