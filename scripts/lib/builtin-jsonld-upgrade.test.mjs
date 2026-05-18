import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectBuiltinUrl,
  parseBuiltinJsonLd,
  pickBestLocation,
  upgradeBuiltinResult,
} from "./builtin-jsonld-upgrade.mjs";

// ── detectBuiltinUrl ─────────────────────────────────────────────────────────

test("detectBuiltinUrl — canonical builtin job URL", () => {
  assert.equal(detectBuiltinUrl("https://builtin.com/job/gtm-engineer/9385758"), true);
});

test("detectBuiltinUrl — case-insensitive", () => {
  assert.equal(detectBuiltinUrl("https://BuiltIn.com/job/gtm-engineer/9385758"), true);
});

test("detectBuiltinUrl — rejects non-job paths and other domains", () => {
  assert.equal(detectBuiltinUrl("https://builtin.com/company/airtable"), false);
  assert.equal(detectBuiltinUrl("https://jobs.ashbyhq.com/Gumloop/abc"), false);
  assert.equal(detectBuiltinUrl(""), false);
  assert.equal(detectBuiltinUrl(null), false);
});

// ── parseBuiltinJsonLd ───────────────────────────────────────────────────────

const MULTI_LOC_HTML = `<html><head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [{
      "@context": "https://schema.org",
      "@type": "JobPosting",
      "title": "GTM Engineer",
      "baseSalary": {"@type":"MonetaryAmount","currency":"USD","value":{"@type":"QuantitativeValue","minValue":191000,"maxValue":249300,"unitText":"YEAR"}},
      "employmentType": "FULL_TIME",
      "hiringOrganization": {"@type":"Organization","name":"Airtable"},
      "jobLocation": [
        {"@type":"Place","address":{"@type":"PostalAddress","addressCountry":"USA","addressLocality":"New York","addressRegion":"New York","streetAddress":"35 E 21st St"}},
        {"@type":"Place","address":{"@type":"PostalAddress","addressCountry":"USA","addressLocality":"San Francisco","addressRegion":"California","streetAddress":"799 Market St"}}
      ]
    }]
  }
  </script>
</head></html>`;

test("parseBuiltinJsonLd — extracts JobPosting from nested @graph", () => {
  const parsed = parseBuiltinJsonLd(MULTI_LOC_HTML);
  assert.ok(parsed, "should return a parsed object");
  assert.equal(parsed.title, "GTM Engineer");
  assert.equal(parsed.company, "Airtable");
  assert.equal(parsed.employmentType, "FULL_TIME");
  assert.deepEqual(parsed.baseSalary, { min: 191000, max: 249300 });
  assert.equal(parsed.jobLocations.length, 2);
  assert.deepEqual(parsed.jobLocations[0], { city: "new york", region: "new york", country: "USA" });
  assert.deepEqual(parsed.jobLocations[1], { city: "san francisco", region: "california", country: "USA" });
});

test("parseBuiltinJsonLd — flat (not @graph wrapped) JSON-LD also works", () => {
  const html = `<script type="application/ld+json">
    {"@type":"JobPosting","title":"X","hiringOrganization":{"name":"Co"},
     "jobLocation":{"@type":"Place","address":{"addressLocality":"Boston","addressRegion":"MA","addressCountry":"USA"}}}
    </script>`;
  const parsed = parseBuiltinJsonLd(html);
  assert.equal(parsed.title, "X");
  assert.equal(parsed.jobLocations.length, 1);
  assert.equal(parsed.jobLocations[0].city, "boston");
});

test("parseBuiltinJsonLd — returns null when no JobPosting present", () => {
  assert.equal(parseBuiltinJsonLd("<html>no json-ld here</html>"), null);
  assert.equal(parseBuiltinJsonLd(""), null);
});

test("parseBuiltinJsonLd — handles HTML-encoded plus in type attr (real BuiltIn pages)", () => {
  // BuiltIn writes `application/ld&#x2B;json` (entity-encoded +). Earlier regex
  // matched literal `+` only and silently produced no result.
  const html = `<script type="application/ld&#x2B;json">
    {"@type":"JobPosting","title":"X","hiringOrganization":{"name":"Co"},
     "jobLocation":{"@type":"Place","address":{"addressLocality":"NYC","addressCountry":"USA"}}}
    </script>`;
  const parsed = parseBuiltinJsonLd(html);
  assert.ok(parsed, "should parse despite encoded + in type attr");
  assert.equal(parsed.title, "X");
});

test("parseBuiltinJsonLd — handles decimal HTML entity &#43; for plus too", () => {
  const html = `<script type="application/ld&#43;json">
    {"@type":"JobPosting","title":"Y","hiringOrganization":{"name":"Co"},
     "jobLocation":{"@type":"Place","address":{"addressLocality":"X","addressCountry":"USA"}}}
    </script>`;
  const parsed = parseBuiltinJsonLd(html);
  assert.ok(parsed);
  assert.equal(parsed.title, "Y");
});

test("parseBuiltinJsonLd — handles missing baseSalary gracefully", () => {
  const html = `<script type="application/ld+json">
    {"@type":"JobPosting","title":"X","hiringOrganization":{"name":"Co"},
     "jobLocation":{"@type":"Place","address":{"addressLocality":"NYC"}}}
    </script>`;
  const parsed = parseBuiltinJsonLd(html);
  assert.equal(parsed.baseSalary, null);
});

// ── pickBestLocation ─────────────────────────────────────────────────────────

const NYC_BIAS = {
  preferred: ["new york", "brooklyn", "queens", "jersey city", "hoboken"],
  avoid: ["san francisco", "los angeles", "chicago", "austin", "seattle"],
};

test("pickBestLocation — picks NYC from [NYC, SF] (Airtable case)", () => {
  const locations = [
    { city: "san francisco", region: "california", country: "USA" },
    { city: "new york", region: "new york", country: "USA" },
  ];
  const best = pickBestLocation(locations, NYC_BIAS);
  assert.equal(best.city, "new york");
});

test("pickBestLocation — picks NYC even when listed last", () => {
  const locations = [
    { city: "san francisco", region: "california", country: "USA" },
    { city: "los angeles", region: "california", country: "USA" },
    { city: "new york", region: "new york", country: "USA" },
  ];
  const best = pickBestLocation(locations, NYC_BIAS);
  assert.equal(best.city, "new york");
});

test("pickBestLocation — falls back to first-listed when none preferred and none avoided", () => {
  const locations = [
    { city: "denver", region: "colorado", country: "USA" },
    { city: "boston", region: "massachusetts", country: "USA" },
  ];
  const best = pickBestLocation(locations, NYC_BIAS);
  assert.equal(best.city, "denver");
});

test("pickBestLocation — avoids avoided cities over neutral", () => {
  const locations = [
    { city: "san francisco", region: "california", country: "USA" },
    { city: "denver", region: "colorado", country: "USA" },
  ];
  const best = pickBestLocation(locations, NYC_BIAS);
  assert.equal(best.city, "denver", "should prefer neutral Denver over avoided SF");
});

test("pickBestLocation — single location returned regardless of preference", () => {
  const locations = [{ city: "san francisco", region: "california", country: "USA" }];
  const best = pickBestLocation(locations, NYC_BIAS);
  assert.equal(best.city, "san francisco");
});

test("pickBestLocation — empty array returns null", () => {
  assert.equal(pickBestLocation([], NYC_BIAS), null);
  assert.equal(pickBestLocation(null, NYC_BIAS), null);
});

// ── upgradeBuiltinResult — orchestrator with stub fetch ──────────────────────

function makeFetcher(byUrl) {
  return async (url) => {
    if (byUrl[url]) return { ok: true, status: 200, text: async () => byUrl[url] };
    return { ok: false, status: 404, text: async () => "" };
  };
}

test("upgradeBuiltinResult — Airtable multi-office picks NYC, upgrades workplace+city+comp", async () => {
  const result = {
    url: "https://builtin.com/job/gtm-engineer/9385758",
    title: "GTM Engineer",
    company: "Airtable",
    location: "Unknown",
    location_workplace: "onsite",  // scraper's bad inference
    location_city: null,           // missing city — the trigger
    location_region: null,
    source: "BuiltIn",
    comp: "",
  };
  const fetch = makeFetcher({
    "https://builtin.com/job/gtm-engineer/9385758": MULTI_LOC_HTML,
  });
  const upgraded = await upgradeBuiltinResult(result, { fetch, preferences: NYC_BIAS });

  assert.equal(upgraded.location_city, "new york");
  assert.equal(upgraded.location_workplace, "hybrid", "multi-office should default to hybrid");
  assert.ok(upgraded.comp.includes("191"), `comp should include 191, got ${upgraded.comp}`);
  assert.equal(upgraded.location_upgraded_from, "builtin_jsonld");
  // Multi-location audit: preserve all the locations seen
  assert.equal(upgraded.all_locations.length, 2);
});

test("upgradeBuiltinResult — single-location stays onsite (not hybrid)", async () => {
  const html = `<script type="application/ld+json">
    {"@type":"JobPosting","title":"X","hiringOrganization":{"name":"Co"},
     "jobLocation":{"@type":"Place","address":{"addressLocality":"New York","addressRegion":"NY","addressCountry":"USA"}}}
    </script>`;
  const result = {
    url: "https://builtin.com/job/x/123",
    location_workplace: "onsite",
    location_city: null,
  };
  const fetch = makeFetcher({ "https://builtin.com/job/x/123": html });
  const upgraded = await upgradeBuiltinResult(result, { fetch, preferences: NYC_BIAS });
  assert.equal(upgraded.location_city, "new york");
  assert.equal(upgraded.location_workplace, "onsite", "single-office should stay onsite (no multi-office signal)");
});

test("upgradeBuiltinResult — passthrough for non-BuiltIn URLs", async () => {
  const result = { url: "https://jobs.ashbyhq.com/x/y", location_workplace: "unknown" };
  let calls = 0;
  const fetch = async () => { calls++; return { ok: false, status: 500, text: async () => "" }; };
  const upgraded = await upgradeBuiltinResult(result, { fetch, preferences: NYC_BIAS });
  assert.equal(calls, 0);
  assert.equal(upgraded, result);
});

test("upgradeBuiltinResult — passthrough when both workplace AND city are already known", async () => {
  const result = {
    url: "https://builtin.com/job/x/123",
    location_workplace: "hybrid",
    location_city: "new york",
  };
  let calls = 0;
  const fetch = async () => { calls++; return { ok: false, status: 500, text: async () => "" }; };
  const upgraded = await upgradeBuiltinResult(result, { fetch, preferences: NYC_BIAS });
  assert.equal(calls, 0);
  assert.equal(upgraded, result);
});

test("upgradeBuiltinResult — workplace known but city missing → still upgrades (Airtable case)", async () => {
  // This is the Airtable case: workplace="onsite" (from card icon) but city=null
  const result = {
    url: "https://builtin.com/job/gtm-engineer/9385758",
    location_workplace: "onsite",
    location_city: null,
  };
  const fetch = makeFetcher({
    "https://builtin.com/job/gtm-engineer/9385758": MULTI_LOC_HTML,
  });
  const upgraded = await upgradeBuiltinResult(result, { fetch, preferences: NYC_BIAS });
  assert.equal(upgraded.location_city, "new york");
});

test("upgradeBuiltinResult — graceful degradation on network failure", async () => {
  const result = { url: "https://builtin.com/job/x/123", location_workplace: "unknown" };
  const fetch = async () => { throw new Error("network down"); };
  const upgraded = await upgradeBuiltinResult(result, { fetch, preferences: NYC_BIAS });
  assert.equal(upgraded.location_workplace, "unknown");
  assert.equal(upgraded.location_upgraded_from, undefined);
});
