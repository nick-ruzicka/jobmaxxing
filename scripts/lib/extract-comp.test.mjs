/**
 * Tests for extract-comp.mjs — run with: node --test scripts/lib/extract-comp.test.mjs
 * (uses Node's built-in test runner; no deps; works on Node 18+).
 *
 * Cases mirror the audit sample URLs (audit/comp-extraction-audit-2026-05-13.md):
 *   1 Vultr (BuiltIn, JSON-LD baseSalary, entity-encoded type, @graph)
 *   2 SentiLink (BuiltIn, no baseSalary, comp in description prose — beats the wrong estimate strip)
 *   3 JobNimbus (BuiltIn, null baseSalary, only an algorithmic estimate strip)
 *   4 Apollo (Greenhouse, no JSON-LD, server-rendered "Tier N Pay Range $X-$Y" div)
 *   5 Camunda (Insight Partners / Getro SPA, plain JSON-LD baseSalary)
 *   6 Mural (revopscareers, single-value scalar baseSalary)
 *   7 qualitative-only  8 nothing  9 decodeEntities  10 formatBaseSalary  11 backfill helpers
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractComp,
  decodeEntities,
  formatBaseSalary,
  shouldBackfill,
  applyExtraction,
  isRealComp,
  compInProse,
  builtinSalaryStrip,
} from "./extract-comp.mjs";

// ---------------------------------------------------------------------------
// HTML fixtures (minimal — the JSON-LD <script> + relevant span/div, not whole pages)
// ---------------------------------------------------------------------------
const ldGraph = (jp) =>
  `<script type="application/ld&#x2B;json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [jp] })}</script>`;
const ldPlain = (jp) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...jp })}</script>`;
const sackStrip = (text) =>
  `<div class="job-summary"><span class="fa fa-sack-dollar"></span> ${text}</div>`;

// 1 — Vultr: entity-encoded type, @graph-nested JobPosting, full baseSalary, also a strip + prose
const VULTR_HTML = `<html><head><title>Revenue Operations Manager - Vultr | Built In</title>${ldGraph({
  "@type": "JobPosting",
  title: "Revenue Operations Manager",
  baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: 85000, maxValue: 130000, unitText: "YEAR" } },
  description: "<p><span>Strong communication and stakeholder management abilities</span></p><p>Compensation $85,000 - $130,000 This salary can vary based on location.</p>",
})}</head><body>${sackStrip("85K-130K Annually")}<div class="similar">Other Company 126K-148K Annually</div></body></html>`;

// 2 — SentiLink: no baseSalary; comp lives in the description prose; the strip shows a *wrong* 76K-126K estimate
const SENTILINK_HTML = `<html><head><title>Go-To-Market (GTM) Engineer - SentiLink | Built In</title>${ldGraph({
  "@type": "JobPosting",
  title: "Go-To-Market (GTM) Engineer",
  description: "<p>Work in fast-moving environments, take ownership, and iterate quickly with real-world feedback</p><p>Compensation: $130,000 - $160,000/year + equity + benefits</p><p>Perks: Employer paid group health insurance.</p>",
})}</head><body>${sackStrip("76K-126K Annually")}</body></html>`;

// 3 — JobNimbus: null baseSalary; description has no comp; only the algorithmic estimate strip
const JOBNIMBUS_HTML = `<html><head><title>GTM Engineer - JobNimbus | Built In</title>${ldGraph({
  "@type": "JobPosting",
  title: "GTM Engineer",
  baseSalary: null,
  description: "<p><span>We are obsessed with the hero's journey at JobNimbus. Every person has a hero's journey, and yours starts here.</span></p><p>Build scalable growth systems.</p>",
})}</head><body><span class="font-barlow">75 Employees</span> ${sackStrip("36K-180K Annually")}<div class="similar">8697 Employees 182K-260K Annually</div></body></html>`;

// 4 — Apollo (Greenhouse): NO JSON-LD; pay range in a server-rendered <div>
const APOLLO_GH_HTML = `<html><head><title>Job Application for Go-To-Market Engineer II, Mid-Market at Apollo.io</title></head><body><div class="content"><p>FSA/HSA and medical, dental, and vision benefits.</p><div class="pay">Tier 1 Pay Range (San Francisco, New York City, Seattle) $150,000 - $175,000 USD</div><div class="pay">Tier 2 Pay Range (All other US Locations) $150,000 - $175,000 USD</div></div></body></html>`;

// 5 — Camunda (Insight Partners / Getro): plain JSON-LD type, min/max baseSalary
const CAMUNDA_HTML = `<html><head>${ldPlain({
  "@type": "JobPosting",
  title: "Director, Revenue Operations",
  baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: 209100, maxValue: 313600, unitText: "YEAR" } },
  description: "<p>In 2024, we crossed the $100 million mark in ARR.</p>",
})}</head><body><div id="root"></div></body></html>`;

// 6 — Mural (revopscareers): single-value scalar baseSalary, value as a string
const MURAL_HTML = `<html><head>${ldPlain({
  "@type": "JobPosting",
  title: "Revenue Operations Business Partner",
  baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", value: "93730.0", unitText: "YEAR" } },
  description: "<p>Revenue Operations Business Partner at Mural.</p>",
})}</head><body></body></html>`;

// 7 — qualitative-only
const QUALITATIVE_HTML = `<html><head>${ldPlain({
  "@type": "JobPosting",
  title: "Revenue Operations Analyst",
  baseSalary: null,
  description: "<p>Benefits That Benefit You: Competitive salary and 401(k) with employer match. Discretionary paid time off. Paid parental leave for all.</p>",
})}</head><body></body></html>`;

// 8 — nothing comp-related
const NOTHING_HTML = `<html><head><title>Some Role</title></head><body><div>We're hiring a great person to do great things. Apply now!</div></body></html>`;

// ---------------------------------------------------------------------------
// Case 1–8 — extractComp orchestrator
// ---------------------------------------------------------------------------
test("1. Vultr — JSON-LD baseSalary (entity-encoded type + @graph)", () => {
  assert.deepEqual(extractComp(VULTR_HTML, "https://builtin.com/job/revenue-operations-manager/3596033"), {
    comp_range: "$85,000 – $130,000 /yr",
    comp_source: "jsonld_basesalary",
  });
});

test("2. SentiLink — comp prose in JSON-LD description beats the wrong estimate strip", () => {
  assert.deepEqual(extractComp(SENTILINK_HTML, "https://builtin.com/job/go-market-gtm-engineer/8529185"), {
    comp_range: "$130,000 - $160,000/year",
    comp_source: "jsonld_description",
  });
});

test("3. JobNimbus — null baseSalary, no prose comp → labelled BuiltIn estimate strip", () => {
  assert.deepEqual(extractComp(JOBNIMBUS_HTML, "https://builtin.com/job/gtm-engineer/9272376"), {
    comp_range: "$36K – $180K (est.)",
    comp_source: "jd_estimate",
  });
});

test("4. Apollo (Greenhouse) — server-rendered 'Tier N Pay Range $X-$Y' div, no JSON-LD", () => {
  assert.deepEqual(extractComp(APOLLO_GH_HTML, "https://job-boards.greenhouse.io/apolloio/jobs/5918855004"), {
    comp_range: "$150,000 - $175,000",
    comp_source: "jd_prose",
  });
});

test("5. Camunda (Insight Partners) — plain JSON-LD baseSalary min/max", () => {
  assert.deepEqual(extractComp(CAMUNDA_HTML, "https://jobs.insightpartners.com/companies/camunda/jobs/47555852-director-revenue-operations"), {
    comp_range: "$209,100 – $313,600 /yr",
    comp_source: "jsonld_basesalary",
  });
});

test("6. Mural (revopscareers) — single-value scalar baseSalary", () => {
  assert.deepEqual(extractComp(MURAL_HTML, "https://revopscareers.com/job/mural-revenue-operations-business-partner-united-states"), {
    comp_range: "$93,730 /yr",
    comp_source: "jsonld_basesalary",
  });
});

test("7. qualitative-only → comp_range null, comp_source qualitative_only", () => {
  assert.deepEqual(extractComp(QUALITATIVE_HTML, "https://jobs.generalcatalyst.com/companies/x/jobs/1"), {
    comp_range: null,
    comp_source: "qualitative_only",
  });
});

test("8. nothing comp-related → none", () => {
  assert.deepEqual(extractComp(NOTHING_HTML, "https://example.com/jobs/1"), {
    comp_range: null,
    comp_source: "none",
  });
});

// ---------------------------------------------------------------------------
// Case 9 — decodeEntities
// ---------------------------------------------------------------------------
test("9. decodeEntities normalises &#x2B; / &#43; / &#x2b; → +", () => {
  assert.equal(decodeEntities('type="application/ld&#x2B;json"'), 'type="application/ld+json"');
  assert.equal(decodeEntities('type="application/ld&#43;json"'), 'type="application/ld+json"');
  assert.equal(decodeEntities('type="application/ld&#x2b;json"'), 'type="application/ld+json"');
  assert.equal(decodeEntities("a &amp; b"), "a & b");
});

// ---------------------------------------------------------------------------
// Case 10 — formatBaseSalary
// ---------------------------------------------------------------------------
test("10. formatBaseSalary — range / single / scalar / empty / currency", () => {
  assert.equal(
    formatBaseSalary({ "@type": "MonetaryAmount", currency: "USD", value: { minValue: 85000, maxValue: 130000, unitText: "YEAR" } }),
    "$85,000 – $130,000 /yr"
  );
  assert.equal(
    formatBaseSalary({ currency: "USD", value: { minValue: 225000, maxValue: 225000, unitText: "YEAR" } }),
    "$225,000 /yr"
  );
  assert.equal(formatBaseSalary({ currency: "USD", value: { value: 93730, unitText: "YEAR" } }), "$93,730 /yr");
  assert.equal(formatBaseSalary({ currency: "USD", value: { value: "93730.0", unitText: "YEAR" } }), "$93,730 /yr");
  assert.equal(formatBaseSalary({ value: { minValue: null, maxValue: null, unitText: "PERIOD_NOT_DEFINED" } }), null);
  assert.equal(formatBaseSalary(null), null);
  assert.equal(formatBaseSalary({}), null);
  assert.equal(formatBaseSalary({ currency: "USD", value: 120000 }), "$120,000");
  assert.equal(
    formatBaseSalary({ currency: "EUR", value: { minValue: 80000, maxValue: 100000, unitText: "YEAR" } }),
    "€80,000 – €100,000 /yr"
  );
  assert.equal(
    formatBaseSalary({ currency: "USD", value: { minValue: 60, maxValue: 90, unitText: "HOUR" } }),
    "$60 – $90 /hr"
  );
});

// ---------------------------------------------------------------------------
// helper sanity — compInProse / builtinSalaryStrip / isRealComp
// ---------------------------------------------------------------------------
test("compInProse only fires near a comp keyword; ignores '$100 million ARR'", () => {
  assert.equal(compInProse("we crossed the $100 million mark in ARR"), null);
  assert.equal(compInProse("Pay Transparency Range $130,000 - $165,000 USD"), "$130,000 - $165,000");
  assert.equal(compInProse("the salary range for this role is $100,000–$200,000."), "$100,000–$200,000");
  assert.equal(compInProse("Pay: $3,000–$5,000/month (flexible)"), "$3,000–$5,000/month");
});

test("builtinSalaryStrip grabs the first NNK-MMK band only", () => {
  assert.equal(builtinSalaryStrip('<span class="fa-sack-dollar"></span> 85K-130K Annually <div>126K-148K Annually</div>'), "$85K – $130K");
  assert.equal(builtinSalaryStrip("<div>no icon here 90K-120K</div>"), null);
});

test("isRealComp distinguishes comp values from 'Not listed' / qualitative", () => {
  assert.equal(isRealComp("$120K - $150K"), true);
  assert.equal(isRealComp("$85,000 – $130,000 /yr"), true);
  assert.equal(isRealComp("$36K – $180K (est.)"), true);
  assert.equal(isRealComp("Not listed"), false);
  assert.equal(isRealComp("None"), false);
  assert.equal(isRealComp(""), false);
  assert.equal(isRealComp("Competitive salary"), false);
  assert.equal(isRealComp(undefined), false);
});

// ---------------------------------------------------------------------------
// Case 11 — shouldBackfill / applyExtraction
// ---------------------------------------------------------------------------
test("11a. shouldBackfill", () => {
  assert.equal(shouldBackfill({ comp_range: "Not listed" }), true);
  assert.equal(shouldBackfill({ comp_range: "None" }), true);
  assert.equal(shouldBackfill({}), true);
  assert.equal(shouldBackfill({ comp_range: "$200K", comp_source: undefined }), true); // legacy Claude value, eligible for upgrade
  assert.equal(shouldBackfill({ comp_range: "$120K - $150K", comp_source: "claude_extracted" }), true);
  assert.equal(shouldBackfill({ comp_range: "$120K - $150K", comp_source: "jsonld_basesalary" }), false);
  assert.equal(shouldBackfill({ comp_range: "$120K - $150K", comp_source: "jd_prose" }), false);
  assert.equal(shouldBackfill({ error: "no_jd", timestamp: "2026-05-01T00:00:00Z" }), false);
});

test("11b. applyExtraction — fills empty, upgrades Claude only with baseSalary, never clobbers with prose", () => {
  const now = "2026-05-13T00:00:00Z";

  // empty → fill from baseSalary
  let r = applyExtraction({ comp_range: "Not listed", fit_score: 7 }, { comp_range: "$85,000 – $130,000 /yr", comp_source: "jsonld_basesalary" }, now);
  assert.equal(r.changed, true);
  assert.equal(r.entry.comp_range, "$85,000 – $130,000 /yr");
  assert.equal(r.entry.comp_source, "jsonld_basesalary");
  assert.equal(r.entry.comp_backfilled_at, now);
  assert.equal(r.entry.fit_score, 7); // other fields preserved

  // real Claude value — do NOT clobber with a prose hit
  r = applyExtraction({ comp_range: "$120K-$150K", comp_source: "claude_extracted" }, { comp_range: "$140K", comp_source: "jd_prose" }, now);
  assert.equal(r.changed, false);
  assert.equal(r.entry.comp_range, "$120K-$150K");

  // real Claude value — DO upgrade to structured baseSalary
  r = applyExtraction({ comp_range: "$120K-$150K", comp_source: "claude_extracted" }, { comp_range: "$130,000 – $160,000 /yr", comp_source: "jsonld_basesalary" }, now);
  assert.equal(r.changed, true);
  assert.equal(r.entry.comp_range, "$130,000 – $160,000 /yr");
  assert.equal(r.entry.comp_source, "jsonld_basesalary");

  // qualitative → tag the row
  r = applyExtraction({ comp_range: "Not listed" }, { comp_range: null, comp_source: "qualitative_only" }, now);
  assert.equal(r.changed, true);
  assert.equal(r.entry.comp_range, "Not listed");
  assert.equal(r.entry.comp_source, "qualitative_only");
  assert.equal(r.entry.comp_backfilled_at, now);

  // qualitative again on an already-tagged row → no change
  r = applyExtraction({ comp_range: "Not listed", comp_source: "qualitative_only" }, { comp_range: null, comp_source: "qualitative_only" }, now);
  assert.equal(r.changed, false);

  // none → untouched
  r = applyExtraction({ comp_range: "Not listed" }, { comp_range: null, comp_source: "none" }, now);
  assert.equal(r.changed, false);
  assert.equal(r.entry.comp_range, "Not listed");
});
