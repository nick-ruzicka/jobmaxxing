#!/usr/bin/env node
// Targeted location re-scan: re-fetch the JD for seen-urls.json entries that the backfill
// couldn't resolve (workplace=unknown or "Hybrid (location unclear)"), run the deterministic
// location resolver against fresh data, and write the upgraded structured fields back.
//
// Does NOT call Claude / re-enrich. Does NOT discover new roles. Does NOT touch entries
// that already have a concrete location.
//
// Sources, in priority order:
//   - Ashby (api.ashbyhq.com/posting-api/job-board)
//   - Greenhouse (boards-api.greenhouse.io)
//   - BuiltIn (individual job pages — JobPosting JSON-LD with entity-encoded script type)
//   - Generic HTML fallback (looks for JSON-LD JobPosting on any page; else body text)
//
// Aggregator hosts (RevOps Careers, Lensa, etc.) are SKIPPED — their metadata is unreliable
// and they're hidden from default views anyway.
//
// Usage:
//   node scripts/rescan-locations.mjs                   # all unresolved, concurrency=3
//   node scripts/rescan-locations.mjs --dry-run         # no writes
//   node scripts/rescan-locations.mjs --concurrency 1   # if BuiltIn WAF starts 403ing
//   node scripts/rescan-locations.mjs --filter hybrid-unclear  # only "Hybrid (location unclear)"
//   node scripts/rescan-locations.mjs --limit 20        # smoke test on first 20

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { resolveTextLocation, resolveStructuredLocation } from "./lib/location.mjs";
import { clusterForLocation, flattenLocation } from "./lib/location-clusters.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })();
const FILTER = (() => { const i = args.indexOf("--filter"); return i >= 0 ? args[i + 1] : "unknown"; })();
let CONCURRENCY = (() => { const i = args.indexOf("--concurrency"); return i >= 0 ? parseInt(args[i + 1], 10) : 3; })();

// AGGREGATOR_HOSTS canonical list lives in config/source-classification.json —
// imported via scripts/lib/source-classification.mjs.
import { isAggregatorHost } from "./lib/source-classification.mjs";

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function isAggregator(url) {
  return isAggregatorHost(url);
}

function stripHtml(html) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function htmlUnescape(s) {
  return (s || "")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

const UA = "Mozilla/5.0 (compatible; career-ops/1.0; +location-rescan)";
const FETCH_TIMEOUT_MS = 12000;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) return { ok: false, status: res.status, json: null };
  try { return { ok: true, status: res.status, json: await res.json() }; } catch { return { ok: false, status: res.status, json: null }; }
}

// Pull the first JobPosting object from any JSON-LD <script> in the HTML.
// Handles BuiltIn's entity-encoded script type (`application/ld&#x2B;json`) and HTML-escaped
// body — both real, both documented in reference_builtin_jsonld.md.
function extractJobPostingJsonLd(html) {
  const re = /<script[^>]*type=("|')application\/ld(?:\+|&#x2B;)json\1[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = htmlUnescape(m[2]);
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    const items = Array.isArray(data) ? data : (data["@graph"] ? data["@graph"] : [data]);
    for (const item of items) {
      if (!item) continue;
      const t = item["@type"];
      if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return item;
    }
  }
  return null;
}

// Full-name → 2-letter postal code (parseLocationString only knows the 2-letter codes).
const STATE_NAME_TO_CODE = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co",
  connecticut: "ct", delaware: "de", "district of columbia": "dc", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks",
  kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma",
  michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm",
  "new york": "ny", "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};

// Map a JobPosting JSON-LD object to a structured location triple.
//
// IMPORTANT: `applicantLocationRequirements` is about WHO CAN APPLY (e.g. "US citizens"),
// NOT where the work happens. Sift has it set but is a hybrid role in Marina del Rey — so
// we must NOT treat it as a remote signal. The only authoritative JSON-LD remote signal is
// `jobLocationType: "TELECOMMUTE"`. Description-text "hybrid" wins over everything else
// (matches the resolver's hybrid > onsite > remote priority).
function jsonLdToStructured(jp, urlForFallback) {
  const jls = Array.isArray(jp.jobLocation) ? jp.jobLocation : (jp.jobLocation ? [jp.jobLocation] : []);
  const a0 = jls[0]?.address;
  const city = a0?.addressLocality || "";
  let region = a0?.addressRegion || "";
  // Normalize "California" → "ca" so parseLocationString picks it up.
  const rlc = region.toLowerCase();
  if (STATE_NAME_TO_CODE[rlc]) region = STATE_NAME_TO_CODE[rlc];
  else if (region.length === 2) region = region.toLowerCase();
  let country = a0?.addressCountry;
  if (country && typeof country === "object") country = country.name || country["@id"] || "";
  // Build the location string the structured resolver will parse for city/region. Drop
  // a US-only country (it's noise that confuses the parser) but keep a non-US country.
  const countryStr = country && !/^(usa|united states|us)$/i.test(country) ? country : "";
  const locStr = [city, region, countryStr].filter(Boolean).join(", ");
  const desc = stripHtml(jp.description || "");
  const hasConcreteLocation = !!city;
  const jsonLdRemote = jp.jobLocationType === "TELECOMMUTE";
  let workplaceType = null;
  if (/\bhybrid\b/i.test(desc) || /\b\d+\s*days?\s*(a|per)\s*week\s+in\b/i.test(desc)) workplaceType = "Hybrid";
  else if (jsonLdRemote) workplaceType = "Remote";
  else if (/\bfully remote\b|\bremote[- ]first\b|\b100% remote\b/i.test(desc)) workplaceType = "Remote";
  else if (hasConcreteLocation) workplaceType = "OnSite";
  if (locStr || workplaceType) return resolveStructuredLocation(locStr, false, workplaceType);
  // Last resort: run the text resolver over the description body.
  return resolveTextLocation(jp.title || "", urlForFallback, desc.slice(0, 5000));
}

async function resolveAshby(url, title) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length < 2) return { error: "ashby bad-url" };
    const [slug, jobId] = parts;
    const r = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
    if (!r.ok) return { error: `ashby ${r.status}` };
    const job = (r.json.jobs || []).find((j) => j.id === jobId);
    if (!job) return { error: "ashby not-found" };
    return resolveStructuredLocation(job.location || "", !!job.isRemote, job.workplaceType || null);
  } catch (e) { return { error: `ashby ${e.message}` }; }
}

async function resolveGreenhouse(url, title) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const jobsIdx = parts.indexOf("jobs");
    const slug = jobsIdx >= 1 ? parts[jobsIdx - 1] : null;
    const jobId = jobsIdx >= 0 ? parts[jobsIdx + 1] : null;
    if (!slug || !jobId) return { error: "greenhouse bad-url" };
    const r = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`);
    if (!r.ok) return { error: `greenhouse ${r.status}` };
    const job = r.json;
    const locStr = job.location?.name || "";
    const text = stripHtml(job.content || "");
    return resolveTextLocation(title || job.title || "", url, (locStr + " " + text).trim());
  } catch (e) { return { error: `greenhouse ${e.message}` }; }
}

// BuiltIn job-detail pages render the workplace type in the page chrome too — an
// `<i class="… fa-house-building …">` icon immediately followed by "Hybrid" / "Remote" /
// "In-Office" text. The JSON-LD `description` often doesn't repeat that word, so when the
// JSON-LD reports a concrete city we still want to consult the chrome to upgrade onsite →
// hybrid where appropriate. Mirrors the listing-page parser in scanBuiltIn().
function builtinChromeWorkplace(html) {
  const m = html.match(/fa-house-building[^>]*>[\s\S]{0,80}?>(?:\s|<[^>]+>)*([A-Z][A-Za-z- ]{1,30})/);
  if (!m) return null;
  const v = m[1].trim().toLowerCase();
  if (v.startsWith("hybrid")) return "Hybrid";
  if (v.startsWith("remote")) return "Remote";
  if (v.startsWith("in-office") || v.startsWith("in office") || v.startsWith("on-site") || v.startsWith("onsite")) return "OnSite";
  return null;
}

async function resolveBuiltin(url, title) {
  try {
    const r = await fetchText(url);
    if (!r.ok) return { error: `builtin ${r.status}` };
    const jp = extractJobPostingJsonLd(r.text);
    if (jp) {
      const result = jsonLdToStructured(jp, url);
      // If JSON-LD says onsite but the page chrome explicitly says Hybrid/Remote, trust
      // the chrome — it matches what users see on the listing card.
      const chrome = builtinChromeWorkplace(r.text);
      if (chrome === "Hybrid" && result.workplace === "onsite") result.workplace = "hybrid";
      else if (chrome === "Remote" && result.workplace !== "remote") result.workplace = "remote";
      return result;
    }
    // No JSON-LD on this page — body fallback
    const text = stripHtml(r.text).slice(0, 5000);
    if (text.length < 200) return { error: "builtin no-body" };
    return resolveTextLocation(title || "", url, text);
  } catch (e) { return { error: `builtin ${e.message}` }; }
}

async function resolveHtml(url, title) {
  try {
    const r = await fetchText(url);
    if (!r.ok) return { error: `html ${r.status}` };
    const jp = extractJobPostingJsonLd(r.text);
    if (jp) return jsonLdToStructured(jp, url);
    const text = stripHtml(r.text).slice(0, 5000);
    if (text.length < 200) return { error: "html too-short" };
    return resolveTextLocation(title || "", url, text);
  } catch (e) { return { error: `html ${e.message}` }; }
}

async function resolveOne(url, entry) {
  if (isAggregator(url)) return { skipped: "aggregator" };
  const title = entry.title || "";
  const host = hostOf(url);
  if (host.endsWith("ashbyhq.com")) return resolveAshby(url, title);
  if (host.endsWith("greenhouse.io")) return resolveGreenhouse(url, title);
  if (host === "builtin.com" || /^builtin\w*\.(com|org)$/.test(host)) return resolveBuiltin(url, title);
  return resolveHtml(url, title);
}

async function main() {
  const seen = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
  let candidates = Object.entries(seen).filter(([url, e]) => {
    if (FILTER === "hybrid-unclear") return /\(location unclear\)/.test(e.location || "");
    if (FILTER === "ashby-remote") {
      // Targeted second pass: Ashby roles the OLD classifier stamped "remote" without
      // consulting workplaceType. The new resolveStructuredLocation uses workplaceType
      // when the API returns it, so re-fetching can flip these to hybrid/onsite.
      return hostOf(url).endsWith("ashbyhq.com") && e.location_workplace === "remote";
    }
    return e.location_workplace === "unknown" || /\(location unclear\)/.test(e.location || "");
  });
  if (LIMIT < Infinity) candidates = candidates.slice(0, LIMIT);
  console.log(`Targeted re-scan: ${candidates.length} candidates, concurrency=${CONCURRENCY}${DRY ? " (DRY RUN)" : ""}`);
  console.log(`  filter: ${FILTER}`);

  const stats = { resolved: 0, stillUnknown: 0, aggregatorSkipped: 0, errors: 0, byCluster: {}, byHost: {}, byErrorKind: {} };
  const errorSamples = [];

  let i = 0;
  let wafBackedOff = false;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= candidates.length) return;
      const [url, entry] = candidates[idx];
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { result = await resolveOne(url, entry); } catch (e) { result = { error: e.message }; }
        if (result?.error && /\b(403|429)\b/.test(result.error)) {
          if (!wafBackedOff && CONCURRENCY > 1) {
            wafBackedOff = true;
            console.log(`\n[!] WAF hit (${result.error}) — dropping concurrency to 1 and backing off 8s`);
            CONCURRENCY = 1;
          }
          await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
          continue;
        }
        break;
      }
      if (result?.skipped === "aggregator") {
        stats.aggregatorSkipped++;
        process.stdout.write("a");
      } else if (result?.error) {
        stats.errors++;
        const kind = result.error.split(/\s+/)[0];
        stats.byErrorKind[kind] = (stats.byErrorKind[kind] || 0) + 1;
        if (errorSamples.length < 30) errorSamples.push({ url, err: result.error, title: entry.title });
        process.stdout.write("x");
      } else {
        const cluster = clusterForLocation(result);
        const flat = flattenLocation(result);
        const meaningful = result.city || result.workplace !== "unknown";
        if (meaningful && cluster !== "unknown") {
          stats.resolved++;
          stats.byCluster[cluster] = (stats.byCluster[cluster] || 0) + 1;
          const h = hostOf(url);
          stats.byHost[h] = (stats.byHost[h] || 0) + 1;
          process.stdout.write(".");
        } else {
          stats.stillUnknown++;
          process.stdout.write("?");
        }
        if (!DRY) {
          entry.location = flat;
          entry.location_workplace = result.workplace;
          entry.location_city = result.city;
          entry.location_region = result.region;
        }
      }
      if ((idx + 1) % 50 === 0) process.stdout.write(` [${idx + 1}/${candidates.length}]\n`);
    }
  }

  const workerCount = CONCURRENCY;
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  console.log();

  if (!DRY) writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");

  console.log("\n=== Re-scan summary ===");
  console.log("Total candidates:    ", candidates.length);
  console.log("Resolved (clustered):", stats.resolved);
  console.log("Still unknown:       ", stats.stillUnknown);
  console.log("Aggregator skipped:  ", stats.aggregatorSkipped);
  console.log("Errors:              ", stats.errors);
  if (Object.keys(stats.byCluster).length) {
    console.log("\nResolved by cluster:");
    for (const [k, v] of Object.entries(stats.byCluster).sort((a, b) => b[1] - a[1])) console.log("  ", String(v).padStart(4), k);
  }
  if (Object.keys(stats.byHost).length) {
    console.log("\nResolved by host (top 10):");
    for (const [k, v] of Object.entries(stats.byHost).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log("  ", String(v).padStart(4), k);
  }
  if (Object.keys(stats.byErrorKind).length) {
    console.log("\nErrors by kind:");
    for (const [k, v] of Object.entries(stats.byErrorKind).sort((a, b) => b[1] - a[1])) console.log("  ", String(v).padStart(4), k);
  }
  if (errorSamples.length) {
    console.log("\nError samples (first 30):");
    for (const e of errorSamples) console.log("  ", e.err.padEnd(20), "|", String(e.title || "").slice(0, 50).padEnd(50), "|", e.url.slice(0, 90));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
