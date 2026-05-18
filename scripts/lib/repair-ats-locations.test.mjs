import { test } from "node:test";
import assert from "node:assert/strict";
import { repairAtsLocations } from "./repair-ats-locations.mjs";

// Stub fetcher: returns a synthetic Ashby API response for the Gumloop slug.
function stubFetch(byUrl) {
  return async (url) => {
    if (byUrl[url]) return { ok: true, status: 200, json: async () => byUrl[url] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const GUMLOOP_API_RESPONSE = {
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
};

test("repairAtsLocations — upgrades Ashby URL with workplace=unknown", async () => {
  const seen = {
    "https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6": {
      firstSeen: "2026-05-17",
      title: "GTM Operations Lead @ Gumloop - Jobs",
      company: "Jobs",
      location: "Unknown",
      location_workplace: "unknown",
      location_city: null,
      location_region: null,
      source: "Tier 8: Deep",
    },
  };
  const fetch = stubFetch({
    "https://api.ashbyhq.com/posting-api/job-board/Gumloop?includeCompensation=true": GUMLOOP_API_RESPONSE,
  });

  const result = await repairAtsLocations(seen, { fetch });

  assert.equal(result.stats.scanned, 1);
  assert.equal(result.stats.upgraded, 1);
  assert.equal(result.stats.skipped_already_known, 0);
  assert.equal(result.stats.skipped_non_ats, 0);

  const gumloop = seen["https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6"];
  assert.equal(gumloop.company, "Gumloop");
  assert.equal(gumloop.title, "GTM Operations Lead");
  assert.equal(gumloop.location_workplace, "onsite");
  assert.equal(gumloop.location_city, "san francisco");
  assert.equal(gumloop.location_upgraded_from, "ats_api");
  // Preserves untouched fields
  assert.equal(gumloop.firstSeen, "2026-05-17");
  assert.equal(gumloop.source, "Tier 8: Deep");
});

test("repairAtsLocations — skips entries with workplace already known", async () => {
  const seen = {
    "https://jobs.ashbyhq.com/adapt/abc": {
      location_workplace: "onsite",
      location_city: "san francisco",
      company: "adapt",
      title: "GTM / RevOps Engineer @ Adapt API",
    },
  };
  let fetchCalls = 0;
  const fetch = async () => { fetchCalls++; return { ok: false, status: 500, json: async () => ({}) }; };

  const result = await repairAtsLocations(seen, { fetch });

  assert.equal(fetchCalls, 0, "should not fetch for already-known entries");
  assert.equal(result.stats.upgraded, 0);
  assert.equal(result.stats.skipped_already_known, 1);
});

test("repairAtsLocations — skips non-ATS URLs entirely", async () => {
  const seen = {
    "https://builtin.com/job/gtm-engineer/8843434": {
      location_workplace: "unknown",
      company: "Anaconda",
    },
  };
  let fetchCalls = 0;
  const fetch = async () => { fetchCalls++; return { ok: false, status: 500, json: async () => ({}) }; };

  const result = await repairAtsLocations(seen, { fetch });

  assert.equal(fetchCalls, 0);
  assert.equal(result.stats.upgraded, 0);
  assert.equal(result.stats.skipped_non_ats, 1);
});

test("repairAtsLocations — mixed batch: upgrades exactly the qualifying entries", async () => {
  const seen = {
    "https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6": {
      location_workplace: "unknown", company: "Jobs",
    },
    "https://jobs.ashbyhq.com/adapt/abc": {
      location_workplace: "onsite", company: "adapt",
    },
    "https://builtin.com/job/foo/123": {
      location_workplace: "unknown", company: "Foo",
    },
    "https://jobs.ashbyhq.com/notarealco/xyz": {
      location_workplace: "unknown", company: "?",  // API returns 404
    },
  };
  const fetch = stubFetch({
    "https://api.ashbyhq.com/posting-api/job-board/Gumloop?includeCompensation=true": GUMLOOP_API_RESPONSE,
  });

  const result = await repairAtsLocations(seen, { fetch });

  assert.equal(result.stats.scanned, 4);
  assert.equal(result.stats.upgraded, 1);
  assert.equal(result.stats.skipped_already_known, 1);  // adapt
  assert.equal(result.stats.skipped_non_ats, 1);        // builtin
  assert.equal(result.stats.upgrade_failed, 1);         // notarealco (404)
});

test("repairAtsLocations — dry-run mode does not mutate input", async () => {
  const seen = {
    "https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6": {
      location_workplace: "unknown", company: "Jobs",
    },
  };
  const fetch = stubFetch({
    "https://api.ashbyhq.com/posting-api/job-board/Gumloop?includeCompensation=true": GUMLOOP_API_RESPONSE,
  });

  const result = await repairAtsLocations(seen, { fetch, dryRun: true });

  // Stats still reflect what WOULD happen
  assert.equal(result.stats.upgraded, 1);
  // But input is untouched
  const gumloop = seen["https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6"];
  assert.equal(gumloop.company, "Jobs");
  assert.equal(gumloop.location_workplace, "unknown");
  // Result exposes the would-be-upgraded record for preview
  assert.equal(result.previews.length, 1);
  assert.equal(result.previews[0].url, "https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6");
  assert.equal(result.previews[0].upgraded.location_workplace, "onsite");
});
