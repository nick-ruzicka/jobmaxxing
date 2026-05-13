import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTextLocation,
  resolveStructuredLocation,
  locationFields,
} from "./location.mjs";
import { clusterForLocation } from "./location-clusters.mjs";

test("resolveStructuredLocation — Ashby workplaceType=Hybrid + city string (incident.io GTM)", () => {
  const loc = resolveStructuredLocation("San Francisco", false, "Hybrid");
  assert.deepEqual(loc, { workplace: "hybrid", city: "san francisco", region: null });
  assert.equal(clusterForLocation(loc), "sf_bay");
});

test("resolveStructuredLocation — Ashby workplaceType=OnSite NYC", () => {
  const loc = resolveStructuredLocation("New York, NY", false, "OnSite");
  assert.equal(loc.workplace, "onsite");
  assert.equal(clusterForLocation(loc), "nyc");
});

test("resolveStructuredLocation — Ashby Remote, no city", () => {
  const loc = resolveStructuredLocation("Remote - US", true, "Remote");
  assert.equal(loc.workplace, "remote");
  assert.equal(clusterForLocation(loc), "remote");
});

test("resolveStructuredLocation — Greenhouse city string only", () => {
  const loc = resolveStructuredLocation("Marina del Rey, CA", false, null);
  assert.deepEqual(loc, { workplace: "onsite", city: "marina del rey", region: "ca" });
  assert.equal(clusterForLocation(loc), "la");
});

test("resolveTextLocation — Sift Stack: BuiltIn card 'Hybrid' + 'Marina del Rey, CA, USA'", () => {
  const loc = resolveTextLocation(
    "GTM Engineer Hybrid Marina del Rey, CA, USA",
    "https://builtin.com/job/gtm-engineer/8996992",
    "Hybrid Marina del Rey, CA, USA",
  );
  assert.equal(loc.workplace, "hybrid");
  assert.equal(loc.city, "marina del rey");
  assert.equal(loc.region, "ca");
  assert.equal(clusterForLocation(loc), "la");
});

test("resolveTextLocation — August Law: hybrid in NYC via JD body phrasing", () => {
  const loc = resolveTextLocation(
    "Head of GTM Systems",
    "https://jobs.ashbyhq.com/august-law/abc",
    "We work hybrid, 3 days a week in our New York office in SoHo.",
  );
  assert.equal(loc.workplace, "hybrid");
  assert.equal(clusterForLocation(loc), "nyc");
});

test("resolveTextLocation — pure remote", () => {
  const loc = resolveTextLocation("RevOps Engineer", "https://example.com/jobs/123", "Fully remote, US-based.");
  assert.equal(loc.workplace, "remote");
  assert.equal(clusterForLocation(loc), "remote");
});

test("resolveTextLocation — hybrid with no resolvable city ⇒ flagged unclear", () => {
  const loc = resolveTextLocation("Sales Ops Lead", "https://example.com/jobs/x", "This is a hybrid role.");
  assert.equal(loc.workplace, "hybrid");
  assert.equal(loc.city, null);
  assert.equal(clusterForLocation(loc), "unknown");
});

test("resolveTextLocation — body silent, city recoverable from URL slug", () => {
  const loc = resolveTextLocation("GTM Engineer", "https://jobs.lever.co/acme/founding-gtm-engineer-san-francisco-12345", "Join our growing team.");
  assert.equal(loc.city, "san francisco");
});

test("resolveTextLocation — '-united-states' re-syndication slug is ignored", () => {
  const loc = resolveTextLocation("GTM Engineer", "https://lensa.com/gtm-engineer-new-york-ny-united-states-abc", "Great opportunity!");
  assert.equal(loc.city, null);
  assert.equal(loc.workplace, "unknown");
});

test("resolveTextLocation — onsite SF beats a generic 'remote-friendly culture' aside", () => {
  const loc = resolveTextLocation(
    "GTM Engineer",
    "https://jobs.ashbyhq.com/acme/sf",
    "This is an in-office role at our San Francisco HQ. We have a remote-friendly culture for some teams.",
  );
  assert.equal(loc.workplace, "onsite");
  assert.equal(clusterForLocation(loc), "sf_bay");
});

test("locationFields — returns {location, location_workplace, location_city, location_region}", () => {
  const f = locationFields("GTM Engineer Hybrid Marina del Rey, CA, USA", "https://builtin.com/job/x/1", "Hybrid Marina del Rey, CA, USA");
  assert.deepEqual(Object.keys(f).sort(), ["location", "location_city", "location_region", "location_workplace"]);
  assert.equal(f.location, "Hybrid · LA area");
  assert.equal(f.location_workplace, "hybrid");
  assert.equal(f.location_city, "marina del rey");
  assert.equal(f.location_region, "ca");
});
