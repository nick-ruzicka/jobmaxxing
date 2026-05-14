import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGGREGATOR_HOSTS,
  EXCLUDE_DOMAINS,
  classifySource,
  isAggregatorHost,
  isExcludedHost,
  matchesHostList,
} from "./source-classification.mjs";

test("AGGREGATOR_HOSTS contains the canonical 5 quarantined hosts", () => {
  assert.ok(AGGREGATOR_HOSTS.includes("revopscareers.com"));
  assert.ok(AGGREGATOR_HOSTS.includes("lensa.com"));
  assert.ok(AGGREGATOR_HOSTS.includes("whatjobs.com"));
  assert.ok(AGGREGATOR_HOSTS.includes("jobright.ai"));
  assert.ok(AGGREGATOR_HOSTS.includes("jobgether.com"));
});

test("EXCLUDE_DOMAINS contains the canonical spam-blocked entries", () => {
  // Original 12
  assert.ok(EXCLUDE_DOMAINS.includes("flexionis.wuaze.com"));
  assert.ok(EXCLUDE_DOMAINS.includes("talent.com"));
  assert.ok(EXCLUDE_DOMAINS.includes("jooble.org"));
  assert.ok(EXCLUDE_DOMAINS.includes("careerbuilder.com"));
  // Added 2026-05
  assert.ok(EXCLUDE_DOMAINS.includes("liveblog365.com"));
  assert.ok(EXCLUDE_DOMAINS.includes("wuaze.com"));
  assert.ok(EXCLUDE_DOMAINS.includes("saashero.net"));
  // Merged in from pipeline-health.mjs old copy
  assert.ok(EXCLUDE_DOMAINS.includes("trabajo.org"));
  assert.ok(EXCLUDE_DOMAINS.includes("jobsora.com"));
  assert.ok(EXCLUDE_DOMAINS.includes("jora.com"));
});

test("AGGREGATOR_HOSTS and EXCLUDE_DOMAINS are frozen (drift defense)", () => {
  assert.ok(Object.isFrozen(AGGREGATOR_HOSTS));
  assert.ok(Object.isFrozen(EXCLUDE_DOMAINS));
});

test("matchesHostList — exact match", () => {
  assert.equal(matchesHostList("revopscareers.com", AGGREGATOR_HOSTS), true);
  assert.equal(matchesHostList("notarealhost.example", AGGREGATOR_HOSTS), false);
});

test("matchesHostList — subdomain match", () => {
  assert.equal(matchesHostList("sub.revopscareers.com", AGGREGATOR_HOSTS), true);
  assert.equal(matchesHostList("us.jooble.org", EXCLUDE_DOMAINS), true);
  assert.equal(matchesHostList("hirepath.wuaze.com", EXCLUDE_DOMAINS), true);
});

test("matchesHostList — partial-name false-positive defense", () => {
  // "fake-revopscareers.com" should NOT match "revopscareers.com" (no leading dot).
  assert.equal(
    matchesHostList("fake-revopscareers.com", AGGREGATOR_HOSTS),
    false,
  );
  // Substring without subdomain boundary: also no.
  assert.equal(matchesHostList("revopscareers.com.evil.io", AGGREGATOR_HOSTS), false);
});

test("matchesHostList — empty/null host returns false", () => {
  assert.equal(matchesHostList("", AGGREGATOR_HOSTS), false);
  assert.equal(matchesHostList(null, AGGREGATOR_HOSTS), false);
  assert.equal(matchesHostList(undefined, AGGREGATOR_HOSTS), false);
});

test("classifySource — aggregator URL", () => {
  const r = classifySource("https://revopscareers.com/job/foo-bar-revenue-ops");
  assert.equal(r.type, "aggregator");
  assert.equal(r.host, "revopscareers.com");
});

test("classifySource — aggregator subdomain", () => {
  const r = classifySource("https://api.jobright.ai/job/123");
  assert.equal(r.type, "aggregator");
  assert.equal(r.host, "api.jobright.ai");
});

test("classifySource — excluded URL", () => {
  const r = classifySource("https://hirevector.liveblog365.com/job/x");
  assert.equal(r.type, "excluded");
  assert.equal(r.host, "hirevector.liveblog365.com");
});

test("classifySource — unknown URL (ATS or company-direct)", () => {
  const r = classifySource("https://jobs.ashbyhq.com/eliseai/12345");
  assert.equal(r.type, "unknown");
  assert.equal(r.host, "jobs.ashbyhq.com");
});

test("classifySource — strips www prefix", () => {
  const r = classifySource("https://www.revopscareers.com/job/x");
  assert.equal(r.type, "aggregator");
  assert.equal(r.host, "revopscareers.com");
});

test("classifySource — malformed URL", () => {
  const r = classifySource("not a url");
  assert.equal(r.type, "unknown");
  assert.equal(r.host, null);
});

test("classifySource — exclusion wins over aggregator precedence", () => {
  // Defensive: even if a host were in both lists, EXCLUDE_DOMAINS takes precedence.
  // Not currently the case in the data, but the contract should hold.
  const r = classifySource("https://flexionis.wuaze.com/job/123");
  assert.equal(r.type, "excluded");
});

test("isAggregatorHost / isExcludedHost convenience wrappers", () => {
  assert.equal(isAggregatorHost("https://revopscareers.com/job/x"), true);
  assert.equal(isAggregatorHost("https://jobs.ashbyhq.com/x"), false);
  assert.equal(isExcludedHost("https://hirevector.liveblog365.com/x"), true);
  assert.equal(isExcludedHost("https://jobs.ashbyhq.com/x"), false);
});
