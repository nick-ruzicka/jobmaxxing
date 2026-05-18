import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectAtsUrl,
  upgradeFromAshbyJob,
  upgradeFromGreenhouseJob,
  upgradeAtsResult,
} from "./ats-url-upgrade.mjs";

// ── detectAtsUrl ─────────────────────────────────────────────────────────────

test("detectAtsUrl — ashby lowercase slug", () => {
  const out = detectAtsUrl("https://jobs.ashbyhq.com/adapt/a7b07d6f-59fe-4711-9e1e-686c3d779cf6");
  assert.deepEqual(out, { ats: "ashby", slug: "adapt", jobId: "a7b07d6f-59fe-4711-9e1e-686c3d779cf6" });
});

test("detectAtsUrl — ashby mixed-case slug (Gumloop)", () => {
  const out = detectAtsUrl("https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6");
  assert.deepEqual(out, { ats: "ashby", slug: "Gumloop", jobId: "ae3844e5-7881-4a58-b7fb-748161b6a8b6" });
});

test("detectAtsUrl — greenhouse classic", () => {
  const out = detectAtsUrl("https://boards.greenhouse.io/notion/jobs/1234567");
  assert.deepEqual(out, { ats: "greenhouse", slug: "notion", jobId: "1234567" });
});

test("detectAtsUrl — greenhouse job-boards subdomain", () => {
  const out = detectAtsUrl("https://job-boards.greenhouse.io/anthropic/jobs/9876543");
  assert.deepEqual(out, { ats: "greenhouse", slug: "anthropic", jobId: "9876543" });
});

test("detectAtsUrl — returns null for non-ATS URL", () => {
  assert.equal(detectAtsUrl("https://builtin.com/job/gtm-engineer/8843434"), null);
  assert.equal(detectAtsUrl("https://example.com/careers"), null);
  assert.equal(detectAtsUrl(""), null);
  assert.equal(detectAtsUrl(null), null);
});

test("detectAtsUrl — ashby URL with no jobId returns null", () => {
  assert.equal(detectAtsUrl("https://jobs.ashbyhq.com/Gumloop"), null);
});

// ── upgradeFromAshbyJob ──────────────────────────────────────────────────────

test("upgradeFromAshbyJob — Gumloop SF Office OnSite", () => {
  // Synthetic but mirrors the real Ashby posting-API shape for the Gumloop role.
  const job = {
    id: "ae3844e5-7881-4a58-b7fb-748161b6a8b6",
    title: "GTM Operations Lead",
    location: "San Francisco Office",
    isRemote: false,
    workplaceType: "OnSite",
    compensation: { compensationTierSummary: "$200K – $265K" },
  };
  const out = upgradeFromAshbyJob(job, "Gumloop");
  assert.equal(out.title, "GTM Operations Lead");
  assert.equal(out.company, "Gumloop");
  assert.equal(out.location_workplace, "onsite");
  assert.equal(out.location_city, "san francisco");
  // comp should propagate so the comp:below_floor layer has data to read
  assert.ok(out.comp && out.comp.includes("200K"), `expected comp to include 200K, got ${out.comp}`);
});

test("upgradeFromAshbyJob — Notion hybrid NYC", () => {
  const job = {
    id: "x",
    title: "GTM Engineer",
    location: "New York, NY",
    isRemote: false,
    workplaceType: "Hybrid",
    compensation: null,
  };
  const out = upgradeFromAshbyJob(job, "notion");
  assert.equal(out.company, "Notion");
  assert.equal(out.location_workplace, "hybrid");
  assert.equal(out.location_city, "new york");
});

test("upgradeFromAshbyJob — fully remote (workplaceType=Remote)", () => {
  const job = {
    id: "x",
    title: "DevTools Engineer",
    location: "Remote — US",
    isRemote: true,
    workplaceType: "Remote",
  };
  const out = upgradeFromAshbyJob(job, "anthropic");
  assert.equal(out.company, "Anthropic");
  assert.equal(out.location_workplace, "remote");
});

test("upgradeFromAshbyJob — multi-word slug becomes spaced company name", () => {
  const job = { id: "x", title: "Role", location: "NYC", isRemote: false, workplaceType: "OnSite" };
  const out = upgradeFromAshbyJob(job, "hebbia-ai");
  assert.equal(out.company, "Hebbia ai");
});

// ── upgradeFromGreenhouseJob ─────────────────────────────────────────────────

test("upgradeFromGreenhouseJob — Notion SF role", () => {
  const job = {
    id: 1234567,
    title: "Forward Deployed Engineer",
    location: { name: "San Francisco, CA" },
    absolute_url: "https://boards.greenhouse.io/notion/jobs/1234567",
  };
  const out = upgradeFromGreenhouseJob(job, "notion");
  assert.equal(out.title, "Forward Deployed Engineer");
  assert.equal(out.company, "Notion");
  assert.equal(out.location_workplace, "onsite");
  assert.equal(out.location_city, "san francisco");
});

// ── upgradeAtsResult — orchestrator with injectable fetch ─────────────────────

function makeFetcher(jobsByUrl) {
  return async (url) => {
    if (jobsByUrl[url]) {
      return { ok: true, status: 200, json: async () => jobsByUrl[url] };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("upgradeAtsResult — Gumloop Tier-8 result gets API-upgraded", async () => {
  const result = {
    url: "https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6",
    title: "GTM Operations Lead @ Gumloop - Jobs",
    company: "Jobs",
    location: "Unknown",
    location_workplace: "unknown",
    location_city: null,
    location_region: null,
    source: "Tier 8: Deep",
    comp: "",
  };
  const fetch = makeFetcher({
    "https://api.ashbyhq.com/posting-api/job-board/Gumloop?includeCompensation=true": {
      jobs: [
        {
          id: "ae3844e5-7881-4a58-b7fb-748161b6a8b6",
          title: "GTM Operations Lead",
          location: "San Francisco Office",
          isRemote: false,
          workplaceType: "OnSite",
          compensation: { compensationTierSummary: "$200K – $265K" },
        },
      ],
    },
  });
  const upgraded = await upgradeAtsResult(result, { fetch });

  assert.equal(upgraded.title, "GTM Operations Lead", "title should be cleaned");
  assert.equal(upgraded.company, "Gumloop", "company should come from slug, not 'Jobs'");
  assert.equal(upgraded.location_workplace, "onsite");
  assert.equal(upgraded.location_city, "san francisco");
  assert.ok(upgraded.comp.includes("200K"), `comp should be populated, got ${upgraded.comp}`);
  // Source preservation — upgrade should not erase provenance
  assert.equal(upgraded.source, "Tier 8: Deep");
  // New field: record that an upgrade happened (for audit/observability)
  assert.equal(upgraded.location_upgraded_from, "ats_api");
});

test("upgradeAtsResult — passthrough when location_workplace is already known", async () => {
  const result = {
    url: "https://jobs.ashbyhq.com/adapt/a7b07d6f-59fe-4711-9e1e-686c3d779cf6",
    title: "GTM / RevOps Engineer @ Adapt API",
    company: "adapt",
    location_workplace: "onsite",
    location_city: "san francisco",
    location_region: null,
    source: "Tier 8: Deep",
  };
  let calls = 0;
  const fetch = async () => { calls++; return { ok: false, status: 500, json: async () => ({}) }; };
  const upgraded = await upgradeAtsResult(result, { fetch });
  assert.equal(calls, 0, "should not fetch when location already known");
  assert.deepEqual(upgraded, result, "should be passthrough");
});

test("upgradeAtsResult — passthrough for non-ATS URLs", async () => {
  const result = {
    url: "https://builtin.com/job/gtm-engineer/8843434",
    title: "GTM Engineer",
    company: "Anaconda",
    location_workplace: "unknown",
    location_city: null,
  };
  let calls = 0;
  const fetch = async () => { calls++; return { ok: false, status: 500, json: async () => ({}) }; };
  const upgraded = await upgradeAtsResult(result, { fetch });
  assert.equal(calls, 0, "should not fetch for non-ATS URLs");
  assert.equal(upgraded, result);
});

test("upgradeAtsResult — graceful degradation on API failure", async () => {
  const result = {
    url: "https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6",
    title: "GTM Operations Lead @ Gumloop - Jobs",
    company: "Jobs",
    location_workplace: "unknown",
  };
  const fetch = async () => { throw new Error("network down"); };
  const upgraded = await upgradeAtsResult(result, { fetch });
  // Should return original result, not throw
  assert.equal(upgraded.location_workplace, "unknown");
  assert.equal(upgraded.company, "Jobs"); // unchanged because we couldn't upgrade
});

test("upgradeAtsResult — API returns 404 for unknown slug", async () => {
  const result = {
    url: "https://jobs.ashbyhq.com/notarealcompany/abc123",
    location_workplace: "unknown",
  };
  const fetch = makeFetcher({}); // returns 404 for everything
  const upgraded = await upgradeAtsResult(result, { fetch });
  assert.equal(upgraded.location_workplace, "unknown");
});

test("upgradeAtsResult — API returns job board but jobId not present", async () => {
  const result = {
    url: "https://jobs.ashbyhq.com/Gumloop/no-such-job-id",
    location_workplace: "unknown",
  };
  const fetch = makeFetcher({
    "https://api.ashbyhq.com/posting-api/job-board/Gumloop?includeCompensation=true": {
      jobs: [{ id: "different-id", title: "Other Role", location: "X", isRemote: false, workplaceType: "OnSite" }],
    },
  });
  const upgraded = await upgradeAtsResult(result, { fetch });
  // jobId mismatch → no upgrade, original returned
  assert.equal(upgraded.location_workplace, "unknown");
});
