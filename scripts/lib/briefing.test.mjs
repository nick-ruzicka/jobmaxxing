// scripts/lib/briefing.test.mjs
//
// Unit tests for the deterministic helpers in scripts/generate-briefing.mjs.
// The Claude API call itself is intentionally not covered here — it's tested
// end-to-end via `npm run briefing` against the real pipeline.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  staleApplications,
  topApplyCandidates,
  missedCandidates,
  verifyLocationCandidates,
  recalibrateCandidates,
  parseBriefingResponse,
  buildRoles,
  loadApplications,
} from "../generate-briefing.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function role(overrides = {}) {
  return {
    url: "https://example.com/r",
    title: "GTM Engineer",
    company: "ExampleCo",
    firstSeen: "2026-05-01",
    location: "Remote",
    location_workplace: "remote",
    location_city: "new york",
    fit_score: 7,
    comp_range: "$200K – $250K",
    stack: ["Clay", "Python"],
    green_flags: ["builder seat"],
    red_flags: [],
    verdict: "Strong fit.",
    company_stage: "Series B",
    ai_signal: true,
    build_component: true,
    ...overrides,
  };
}

const today = new Date();
const daysAgoIso = (n) => {
  const d = new Date(today.getTime() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// staleApplications
// ---------------------------------------------------------------------------
test("staleApplications: keeps non-terminal apps older than 3 days", () => {
  const apps = [
    { num: "1", date: daysAgoIso(5), company: "A", role: "GTM Eng", status: "Applied", notes: "" },
    { num: "2", date: daysAgoIso(2), company: "B", role: "GTM Eng", status: "Applied", notes: "" },
    { num: "3", date: daysAgoIso(10), company: "C", role: "GTM Eng", status: "Rejected", notes: "" },
    { num: "4", date: daysAgoIso(7), company: "D", role: "GTM Eng", status: "Interview", notes: "" },
  ];
  const out = staleApplications(apps).map((a) => a.company);
  assert.deepEqual(out, ["D", "A"]); // sorted by days_stale desc
});

test("staleApplications: drops Discovered, Discarded, Skipped, Offer", () => {
  const apps = [
    { num: "1", date: daysAgoIso(20), company: "X", role: "R", status: "Discovered", notes: "" },
    { num: "2", date: daysAgoIso(20), company: "Y", role: "R", status: "Skipped", notes: "" },
    { num: "3", date: daysAgoIso(20), company: "Z", role: "R", status: "Discarded", notes: "" },
    { num: "4", date: daysAgoIso(20), company: "W", role: "R", status: "Offer", notes: "" },
    { num: "5", date: daysAgoIso(20), company: "V", role: "R", status: "Applied", notes: "" },
  ];
  const out = staleApplications(apps).map((a) => a.company);
  assert.deepEqual(out, ["V"]);
});

// ---------------------------------------------------------------------------
// topApplyCandidates / missedCandidates
// ---------------------------------------------------------------------------
test("topApplyCandidates: filters fit_score < 6 and already-applied roles", () => {
  const roles = [
    role({ company: "High", title: "GTM Engineer", fit_score: 9 }),
    role({ company: "Mid", title: "GTM Engineer", fit_score: 6 }),
    role({ company: "Low", title: "GTM Engineer", fit_score: 4 }),
    role({ company: "AlreadyApplied", title: "GTM Engineer", fit_score: 8 }),
  ];
  const applied = new Set(["alreadyapplied|gtm engineer"]);
  const out = topApplyCandidates(roles, applied, 5).map((r) => r.company);
  assert.deepEqual(out, ["High", "Mid"]); // Low filtered, AlreadyApplied filtered
});

test("missedCandidates: only fit_score >= 7", () => {
  const roles = [
    role({ company: "A", fit_score: 7 }),
    role({ company: "B", fit_score: 8 }),
    role({ company: "C", fit_score: 6 }),
  ];
  const applied = new Set();
  const out = missedCandidates(roles, applied, 5).map((r) => r.company);
  assert.deepEqual(out, ["B", "A"]);
});

// ---------------------------------------------------------------------------
// verifyLocationCandidates
// ---------------------------------------------------------------------------
test("verifyLocationCandidates: surfaces roles with unknown workplace OR null city", () => {
  const roles = [
    role({ company: "Unknown", location_workplace: "unknown", fit_score: 8 }),
    role({ company: "NullCity", location_city: null, fit_score: 7 }),
    role({ company: "Known", location_workplace: "remote", location_city: "nyc", fit_score: 9 }),
  ];
  const out = verifyLocationCandidates(roles, 5).map((r) => r.company);
  assert.deepEqual(out, ["Unknown", "NullCity"]);
});

// ---------------------------------------------------------------------------
// recalibrateCandidates
// ---------------------------------------------------------------------------
test("recalibrateCandidates: only fit_score 4..6 inclusive", () => {
  const roles = [
    role({ company: "Low", fit_score: 3 }),
    role({ company: "MidA", fit_score: 4 }),
    role({ company: "MidB", fit_score: 6 }),
    role({ company: "High", fit_score: 7 }),
  ];
  const out = recalibrateCandidates(roles, 5).map((r) => r.company);
  assert.deepEqual(new Set(out), new Set(["MidA", "MidB"]));
});

// ---------------------------------------------------------------------------
// parseBriefingResponse — tolerate the various ways an LLM may wrap JSON.
// ---------------------------------------------------------------------------
test("parseBriefingResponse: bare JSON", () => {
  const r = parseBriefingResponse('{"items":[{"type":"apply","title":"x"}]}');
  assert.equal(r.items.length, 1);
});

test("parseBriefingResponse: fenced JSON block", () => {
  const r = parseBriefingResponse('```json\n{"items":[]}\n```');
  assert.deepEqual(r.items, []);
});

test("parseBriefingResponse: chatter before JSON", () => {
  const r = parseBriefingResponse('Here is the briefing:\n\n{"items":[{"type":"apply"}]}\n\nLet me know if you want changes.');
  assert.equal(r.items.length, 1);
});

test("parseBriefingResponse: throws on missing items[]", () => {
  assert.throws(() => parseBriefingResponse('{"foo":1}'), /items/);
});

test("parseBriefingResponse: throws on no JSON object at all", () => {
  assert.throws(() => parseBriefingResponse("Sorry, I cannot help with that."), /no JSON/i);
});

// ---------------------------------------------------------------------------
// buildRoles: drops scrape failures (entries with { error })
// ---------------------------------------------------------------------------
test("buildRoles: skips enrichment entries with .error", () => {
  const seen = {
    "u1": { title: "GTM Eng", company: "A", firstSeen: "2026-05-01" },
    "u2": { title: "GTM Eng", company: "B", firstSeen: "2026-05-01" },
  };
  const enr = {
    "u1": { fit_score: 8, verdict: "good" },
    "u2": { error: "scrape failed", timestamp: "2026-05-01" },
  };
  const out = buildRoles(seen, enr).map((r) => r.company);
  assert.deepEqual(out, ["A"]);
});
