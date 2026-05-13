import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clusterForCity,
  clusterForLocation,
  flattenLocation,
  parseLocationString,
  looksUS,
  CLUSTER_META,
  CLUSTER_ORDER,
} from "./location-clusters.mjs";

test("clusterForCity — named metros", () => {
  assert.equal(clusterForCity("New York"), "nyc");
  assert.equal(clusterForCity("Brooklyn"), "nyc");
  assert.equal(clusterForCity("Jersey City"), "nyc");
  assert.equal(clusterForCity("Yonkers"), "nyc");
  assert.equal(clusterForCity("White Plains"), "nyc");
  assert.equal(clusterForCity("Stamford"), "nyc");
  assert.equal(clusterForCity("Princeton"), "nyc");
  assert.equal(clusterForCity("San Francisco"), "sf_bay");
  assert.equal(clusterForCity("Menlo Park"), "sf_bay");
  assert.equal(clusterForCity("Oakland"), "sf_bay");
  assert.equal(clusterForCity("Daly City"), "sf_bay");
  assert.equal(clusterForCity("Marina del Rey"), "la");
  assert.equal(clusterForCity("Santa Monica"), "la");
  assert.equal(clusterForCity("Cambridge"), "boston");
  assert.equal(clusterForCity("Bellevue"), "seattle");
  assert.equal(clusterForCity("Austin"), "austin");
  assert.equal(clusterForCity("Boulder"), "denver");
  assert.equal(clusterForCity("Chicago"), "chicago");
});

test("clusterForCity — compound strings via word-boundary fallback", () => {
  assert.equal(clusterForCity("New York, NY"), "nyc");
  assert.equal(clusterForCity("new york ny usa"), "nyc");
  assert.equal(clusterForCity("Los Angeles CA"), "la");
  assert.equal(clusterForCity("San Francisco, California"), "sf_bay");
});

test("clusterForCity — non-metro and unknown", () => {
  assert.equal(clusterForCity("Atlanta"), null);
  assert.equal(clusterForCity("London"), null);
  assert.equal(clusterForCity(""), null);
  assert.equal(clusterForCity(null), null);
  assert.equal(clusterForCity("Definitely Not A Place"), null);
});

test("looksUS", () => {
  assert.equal(looksUS("Atlanta", "GA"), true);
  assert.equal(looksUS("San Francisco", null), true);
  assert.equal(looksUS("London", "United Kingdom"), false);
  assert.equal(looksUS("London", null), false);
  assert.equal(looksUS("Toronto", null), false);
  assert.equal(looksUS("Mystery Town", null), false);
});

test("clusterForLocation — hybrid carries its city anchor", () => {
  assert.equal(clusterForLocation({ workplace: "hybrid", city: "marina del rey", region: "ca" }), "la");
  assert.equal(clusterForLocation({ workplace: "hybrid", city: "san francisco", region: "ca" }), "sf_bay");
  assert.equal(clusterForLocation({ workplace: "hybrid", city: "new york", region: "ny" }), "nyc");
  assert.equal(clusterForLocation({ workplace: "hybrid", city: null, region: null }), "unknown");
});

test("clusterForLocation — onsite", () => {
  assert.equal(clusterForLocation({ workplace: "onsite", city: "manhattan", region: "ny" }), "nyc");
  assert.equal(clusterForLocation({ workplace: "onsite", city: "atlanta", region: "ga" }), "other_us");
  assert.equal(clusterForLocation({ workplace: "onsite", city: "london", region: "united kingdom" }), "other_intl");
  assert.equal(clusterForLocation({ workplace: "onsite", city: null, region: null }), "unknown");
});

test("clusterForLocation — remote", () => {
  assert.equal(clusterForLocation({ workplace: "remote", city: null, region: null }), "remote");
  assert.equal(clusterForLocation({ workplace: "remote", city: "san francisco", region: "ca" }), "remote");
  assert.equal(clusterForLocation({ workplace: "remote", city: "new york", region: "ny" }), "nyc");
});

test("flattenLocation — display strings", () => {
  assert.equal(flattenLocation({ workplace: "hybrid", city: "marina del rey", region: "ca" }), "Hybrid · LA area");
  assert.equal(flattenLocation({ workplace: "hybrid", city: "new york", region: "ny" }), "Hybrid · NYC area");
  assert.equal(flattenLocation({ workplace: "hybrid", city: null, region: null }), "Hybrid (location unclear)");
  assert.equal(flattenLocation({ workplace: "remote", city: null, region: null }), "Remote US");
  assert.equal(flattenLocation({ workplace: "remote", city: "new york", region: "ny" }), "Remote · NYC area");
  assert.equal(flattenLocation({ workplace: "onsite", city: "san francisco", region: "ca" }), "SF Bay");
  assert.equal(flattenLocation({ workplace: "onsite", city: "atlanta", region: "ga" }), "Atlanta, GA");
  assert.equal(flattenLocation({ workplace: "onsite", city: "london", region: "united kingdom" }), "London, United Kingdom");
  assert.equal(flattenLocation({ workplace: "unknown", city: null, region: null }), "Unknown");
});

test("parseLocationString — legacy & enrichment strings", () => {
  assert.deepEqual(parseLocationString("Hybrid NYC"), { workplace: "hybrid", city: "new york", region: null });
  assert.deepEqual(parseLocationString("Hybrid"), { workplace: "hybrid", city: null, region: null });
  assert.deepEqual(parseLocationString("Remote US"), { workplace: "remote", city: null, region: null });
  assert.deepEqual(parseLocationString("Remote NYC"), { workplace: "remote", city: "new york", region: null });
  assert.deepEqual(parseLocationString("San Francisco"), { workplace: "onsite", city: "san francisco", region: null });
  assert.deepEqual(parseLocationString("On-site Menlo Park"), { workplace: "onsite", city: "menlo park", region: null });
  assert.deepEqual(parseLocationString("New York, NY"), { workplace: "onsite", city: "new york", region: "ny" });
  assert.deepEqual(parseLocationString("Atlanta, GA"), { workplace: "onsite", city: "atlanta", region: "ga" });
  assert.deepEqual(parseLocationString("US-CA-Menlo Park"), { workplace: "onsite", city: "menlo park", region: "ca" });
  assert.deepEqual(parseLocationString("London, England, United Kingdom"), { workplace: "onsite", city: "london", region: "united kingdom" });
  assert.deepEqual(parseLocationString("Unknown"), { workplace: "unknown", city: null, region: null });
  assert.deepEqual(parseLocationString("Not specified"), { workplace: "unknown", city: null, region: null });
  assert.deepEqual(parseLocationString(""), { workplace: "unknown", city: null, region: null });
  assert.deepEqual(parseLocationString("Hybrid · LA area"), { workplace: "hybrid", city: "los angeles", region: null });
});

test("CLUSTER_ORDER / CLUSTER_META cover every cluster clusterForLocation can emit", () => {
  const emitted = ["nyc","remote","sf_bay","la","boston","seattle","austin","denver","chicago","other_us","other_intl","unknown"];
  for (const k of emitted) {
    assert.ok(CLUSTER_META[k], `CLUSTER_META missing ${k}`);
    assert.ok(CLUSTER_ORDER.includes(k), `CLUSTER_ORDER missing ${k}`);
  }
});
