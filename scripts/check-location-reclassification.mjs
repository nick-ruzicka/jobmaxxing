#!/usr/bin/env node

/**
 * check-location-reclassification.mjs — simulate the location rule against stored data.
 *
 * Re-runs the text/URL-based location classifier against every entry in data/seen-urls.json
 * that would actually go through that path on a re-scan (i.e. NOT the Ashby / Greenhouse API
 * tiers — those use classifyLocationStructured, which this tool doesn't touch) and reports
 * how many stored locations would change, with samples.
 *
 * CAVEAT: we don't have the original scraped JD body for stored entries. As a proxy "body"
 * this uses the enrichment's text fields (team_context / green_flags / red_flags / verdict).
 * Real re-scans use the live JD text, which the new rule's Pass 1 prioritizes, so this is an
 * approximation — skewed toward the URL-fallback (Pass 2) behavior. Good enough to sanity-
 * check that the rule does what we want; not a precision instrument.
 *
 * This is a standing tool — re-run it whenever you tweak the location rule. The OLD copy of
 * the classifier below is frozen at the pre-"trust-body-over-URL" version (for before/after);
 * keep classifyLocationNew in sync with scripts/scan-jobs.mjs.
 *
 * Usage: node scripts/check-location-reclassification.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- OLD classifier (frozen pre-Fix-#2 version), for before/after comparison ---
function classifyLocationOld(title, url, text) {
  const blob = `${title} ${url} ${text}`.toLowerCase();
  const nycSignals = ["new york", "nyc", "manhattan", "brooklyn", "soho", "midtown"];
  const remoteSignals = ["remote", "anywhere", "distributed"];
  const hybridSignals = ["hybrid"];
  const isNYC = nycSignals.some((s) => blob.includes(s));
  const isRemote = remoteSignals.some((s) => blob.includes(s));
  const isHybrid = hybridSignals.some((s) => blob.includes(s));
  if (isNYC && isHybrid) return "Hybrid NYC";
  if (isNYC && isRemote) return "Remote NYC";
  if (isNYC) return "NYC";
  if (isHybrid) return "Hybrid";
  if (isRemote) return "Remote US";
  if (blob.includes("san francisco") || blob.includes(", sf")) return "San Francisco";
  if (blob.includes("chicago")) return "Chicago";
  if (blob.includes("boston")) return "Boston";
  if (blob.includes("austin")) return "Austin";
  if (blob.includes("seattle")) return "Seattle";
  return "Unknown";
}

// --- NEW classifier (must mirror scripts/scan-jobs.mjs classifyLocation) ---
function classifyLocationNew(title, url, text) {
  const body = `${title} ${text}`.toLowerCase();
  const urlBlob = (url || "").toLowerCase();
  const nycSignals = ["new york", "nyc", "manhattan", "brooklyn", "soho", "midtown"];
  const remoteSignals = ["remote", "anywhere", "distributed"];
  const hybridSignals = ["hybrid"];

  const bodyNYC = nycSignals.some((s) => body.includes(s));
  const bodyRemote = remoteSignals.some((s) => body.includes(s));
  const bodyHybrid = hybridSignals.some((s) => body.includes(s));

  if (bodyNYC && bodyHybrid) return "Hybrid NYC";
  if (bodyNYC && bodyRemote) return "Remote NYC";
  if (bodyNYC) return "NYC";
  if (bodyHybrid) return "Hybrid";
  if (bodyRemote) return "Remote US";

  if (body.includes("san francisco") || body.includes(", sf")) return "San Francisco";
  if (body.includes("chicago")) return "Chicago";
  if (body.includes("boston")) return "Boston";
  if (body.includes("austin")) return "Austin";
  if (body.includes("seattle")) return "Seattle";

  if (!urlBlob.includes("-united-states")) {
    if (urlBlob.includes("nyc") || urlBlob.includes("new-york")) return "NYC";
    if (urlBlob.includes("san-francisco")) return "San Francisco";
    if (urlBlob.includes("chicago")) return "Chicago";
    if (urlBlob.includes("boston")) return "Boston";
    if (urlBlob.includes("austin")) return "Austin";
    if (urlBlob.includes("seattle")) return "Seattle";
  }

  return "Unknown";
}

const seen = JSON.parse(readFileSync(join(ROOT, "data", "seen-urls.json"), "utf8"));
const enrich = JSON.parse(readFileSync(join(ROOT, "data", "enrichments.json"), "utf8"));

function pseudoBody(url) {
  const e = enrich[url];
  if (!e) return "";
  return [e.team_context, ...(e.green_flags || []), ...(e.red_flags || []), e.verdict]
    .filter(Boolean)
    .join(" ");
}

// Entries that go through the TEXT classifier on a re-scan = everything except the
// structured Ashby / Greenhouse API tiers.
function usesTextClassifier(source) {
  const s = (source || "").toLowerCase();
  return !s.includes("ashby") && !s.includes("greenhouse");
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

let total = 0;
let skippedStructured = 0;
let fnFlipped = 0;
const fnTransitions = {};            // "OLD -> NEW" : count
const storedTransitions = {};        // "STORED -> NEW" : count
const samplesByTransition = {};      // "OLD -> NEW" : [{...}]

for (const [url, meta] of Object.entries(seen)) {
  if (!usesTextClassifier(meta.source)) {
    skippedStructured++;
    continue;
  }
  total++;
  const body = pseudoBody(url);
  const title = meta.title || "";
  const storedLoc = meta.location || "Unknown";
  const oldLoc = classifyLocationOld(title, url, body);
  const newLoc = classifyLocationNew(title, url, body);

  if (oldLoc !== newLoc) {
    fnFlipped++;
    const key = `${oldLoc} -> ${newLoc}`;
    fnTransitions[key] = (fnTransitions[key] || 0) + 1;
    (samplesByTransition[key] ||= []).push({
      url,
      title,
      body: body.replace(/\s+/g, " ").slice(0, 180),
      storedLoc,
      oldLoc,
      newLoc,
    });
  }
  if (storedLoc !== newLoc) {
    storedTransitions[`${storedLoc} -> ${newLoc}`] =
      (storedTransitions[`${storedLoc} -> ${newLoc}`] || 0) + 1;
  }
}

// "Smoking gun": stored as some NYC variant but the URL carries the "-united-states" template.
const smokingGun = [];
for (const [url, meta] of Object.entries(seen)) {
  const loc = meta.location || "";
  if (/nyc/i.test(loc) && url.toLowerCase().includes("-united-states")) {
    smokingGun.push({
      url,
      title: meta.title || "",
      source: meta.source || "",
      storedLoc: loc,
      newLoc: classifyLocationNew(meta.title || "", url, pseudoBody(url)),
    });
  }
}

const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

console.log("\n=== Location reclassification check ===");
console.log(`seen-urls.json entries:            ${Object.keys(seen).length}`);
console.log(`  via structured API (skipped):    ${skippedStructured}`);
console.log(`  via text classifier (examined):  ${total}`);

console.log("\n--- Old classifier vs new classifier (same proxy inputs) ---");
console.log(`Entries whose result changes: ${fnFlipped}`);
for (const [k, v] of sortDesc(fnTransitions)) console.log(`  ${pad(k, 30)} ${v}`);

console.log("\n--- Stored location vs new classifier (would change on a clean re-scan) ---");
const totalStoredFlips = Object.values(storedTransitions).reduce((a, b) => a + b, 0);
console.log(`Total: ${totalStoredFlips}`);
for (const [k, v] of sortDesc(storedTransitions).slice(0, 25)) console.log(`  ${pad(k, 38)} ${v}`);

console.log('\n--- "Smoking gun": stored NYC-variant + URL has "-united-states" template ---');
console.log(`Count: ${smokingGun.length}`);
for (const s of smokingGun.slice(0, 10)) {
  console.log(`  ${pad(s.storedLoc + " -> " + s.newLoc, 24)} [${s.source}]`);
  console.log(`    ${s.url}`);
  console.log(`    "${s.title}"`);
}

console.log("\n--- Sample transitions (old-fn -> new-fn) — up to 2 per transition type, 12 total ---");
let shown = 0;
for (const key of sortDesc(fnTransitions).map(([k]) => k)) {
  for (const s of (samplesByTransition[key] || []).slice(0, 2)) {
    if (shown >= 12) break;
    shown++;
    console.log(`  ${s.oldLoc} -> ${s.newLoc}   (stored: ${s.storedLoc})`);
    console.log(`    url:  ${s.url}`);
    console.log(`    body: ${s.body || "(none)"}`);
  }
  if (shown >= 12) break;
}
console.log("");
