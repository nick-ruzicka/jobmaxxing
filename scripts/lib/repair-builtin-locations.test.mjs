import { test } from "node:test";
import assert from "node:assert/strict";
import { repairBuiltinLocations } from "./repair-builtin-locations.mjs";

// Stub fetcher returning prebuilt HTML responses keyed by URL.
function stubFetch(byUrl) {
  return async (url) => {
    if (byUrl[url]) return { ok: true, status: 200, text: async () => byUrl[url] };
    return { ok: false, status: 404, text: async () => "" };
  };
}

const NYC_BIAS = {
  preferred: ["new york", "brooklyn", "queens"],
  avoid: ["san francisco", "los angeles", "chicago", "austin", "seattle"],
};

const AIRTABLE_HTML = `<script type="application/ld&#x2B;json">
  {
    "@graph": [{
      "@type": "JobPosting",
      "title": "GTM Engineer",
      "hiringOrganization": {"name": "Airtable"},
      "baseSalary": {"@type":"MonetaryAmount","currency":"USD","value":{"minValue":191000,"maxValue":249300,"unitText":"YEAR"}},
      "jobLocation": [
        {"@type":"Place","address":{"addressLocality":"New York","addressRegion":"New York","addressCountry":"USA"}},
        {"@type":"Place","address":{"addressLocality":"San Francisco","addressRegion":"California","addressCountry":"USA"}}
      ]
    }]
  }
  </script>`;

const SINGLE_NYC_HTML = `<script type="application/ld+json">
  {"@type":"JobPosting","title":"Solo Role","hiringOrganization":{"name":"Acme"},
   "jobLocation":{"@type":"Place","address":{"addressLocality":"New York","addressRegion":"NY","addressCountry":"USA"}}}
  </script>`;

test("repairBuiltinLocations — Airtable multi-office: picks NYC + sets hybrid", async () => {
  const seen = {
    "https://builtin.com/job/gtm-engineer/9385758": {
      title: "GTM Engineer",
      company: "Airtable",
      location: "Unknown",
      location_workplace: "onsite",
      location_city: null,
      location_region: null,
      source: "BuiltIn",
    },
  };
  const fetch = stubFetch({ "https://builtin.com/job/gtm-engineer/9385758": AIRTABLE_HTML });
  const result = await repairBuiltinLocations(seen, { fetch, preferences: NYC_BIAS });

  assert.equal(result.stats.upgraded, 1);
  assert.equal(result.stats.skipped_already_known, 0);
  assert.equal(result.stats.skipped_non_builtin, 0);
  assert.equal(result.stats.upgrade_failed, 0);

  const entry = seen["https://builtin.com/job/gtm-engineer/9385758"];
  assert.equal(entry.location_workplace, "hybrid");
  assert.equal(entry.location_city, "new york");
  assert.equal(entry.company, "Airtable");
  assert.ok(entry.comp && entry.comp.includes("191"));
  assert.equal(entry.location_upgraded_from, "builtin_jsonld");
  assert.equal(entry.source, "BuiltIn"); // preserved
});

test("repairBuiltinLocations — skips entries with city already set", async () => {
  const seen = {
    "https://builtin.com/job/x/1": {
      location_workplace: "hybrid",
      location_city: "new york",
      company: "Acme",
    },
  };
  let calls = 0;
  const fetch = async () => { calls++; return { ok: false, status: 500, text: async () => "" }; };
  const result = await repairBuiltinLocations(seen, { fetch, preferences: NYC_BIAS });
  assert.equal(calls, 0);
  assert.equal(result.stats.upgraded, 0);
  assert.equal(result.stats.skipped_already_known, 1);
});

test("repairBuiltinLocations — skips non-BuiltIn URLs entirely", async () => {
  const seen = {
    "https://jobs.ashbyhq.com/Gumloop/abc": { location_workplace: "unknown", location_city: null },
    "https://example.com/job/123": { location_city: null },
  };
  let calls = 0;
  const fetch = async () => { calls++; return { ok: false, status: 500, text: async () => "" }; };
  const result = await repairBuiltinLocations(seen, { fetch, preferences: NYC_BIAS });
  assert.equal(calls, 0);
  assert.equal(result.stats.upgraded, 0);
  assert.equal(result.stats.skipped_non_builtin, 2);
});

test("repairBuiltinLocations — mixed batch: stats partition correctly", async () => {
  const seen = {
    "https://builtin.com/job/gtm-engineer/9385758": {
      location_workplace: "onsite", location_city: null, company: "Airtable",
    },
    "https://builtin.com/job/already-good/1": {
      location_workplace: "hybrid", location_city: "new york", company: "Acme",
    },
    "https://jobs.ashbyhq.com/x/y": {
      location_workplace: "unknown", location_city: null,
    },
    "https://builtin.com/job/will-404/x": {
      location_workplace: "onsite", location_city: null, company: "X",
    },
  };
  const fetch = stubFetch({ "https://builtin.com/job/gtm-engineer/9385758": AIRTABLE_HTML });
  const result = await repairBuiltinLocations(seen, { fetch, preferences: NYC_BIAS });
  assert.equal(result.stats.scanned, 4);
  assert.equal(result.stats.upgraded, 1);
  assert.equal(result.stats.skipped_already_known, 1);
  assert.equal(result.stats.skipped_non_builtin, 1);
  assert.equal(result.stats.upgrade_failed, 1);
});

test("repairBuiltinLocations — dry-run does not mutate input but reports previews", async () => {
  const seen = {
    "https://builtin.com/job/gtm-engineer/9385758": {
      location_workplace: "onsite", location_city: null, company: "Airtable",
    },
  };
  const fetch = stubFetch({ "https://builtin.com/job/gtm-engineer/9385758": AIRTABLE_HTML });
  const result = await repairBuiltinLocations(seen, { fetch, preferences: NYC_BIAS, dryRun: true });

  assert.equal(result.stats.upgraded, 1);
  const entry = seen["https://builtin.com/job/gtm-engineer/9385758"];
  assert.equal(entry.location_city, null, "dry-run should not mutate");
  assert.equal(entry.location_workplace, "onsite");
  assert.equal(result.previews.length, 1);
  assert.equal(result.previews[0].url, "https://builtin.com/job/gtm-engineer/9385758");
  assert.equal(result.previews[0].upgraded.location_city, "new york");
});

test("repairBuiltinLocations — workplace=unknown also qualifies (not just city=null)", async () => {
  // Some BuiltIn entries land with workplace=unknown (card icon empty). That's
  // also a valid trigger for upgrade.
  const seen = {
    "https://builtin.com/job/x/2": {
      location_workplace: "unknown", location_city: "boston", company: "Acme",
    },
  };
  const fetch = stubFetch({ "https://builtin.com/job/x/2": SINGLE_NYC_HTML });
  const result = await repairBuiltinLocations(seen, { fetch, preferences: NYC_BIAS });
  assert.equal(result.stats.upgraded, 1);
});
