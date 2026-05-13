#!/usr/bin/env node
// One-shot backfill: upgrade existing data/seen-urls.json entries to the structured location
// model. Reads cached signals only (the existing `location` string, enrichments.json's
// `location` + narrative text, the URL slug, the title) — does NOT re-fetch JDs (that's
// what the next `node scripts/scan-jobs.mjs` run is for). Dry-run by default; pass --write
// to persist.
//
// Usage:  node scripts/backfill-locations.mjs            # dry run, prints a summary
//         node scripts/backfill-locations.mjs --write    # persist + write a report

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseLocationString, flattenLocation, clusterForLocation } from "./lib/location-clusters.mjs";
import { resolveTextLocation } from "./lib/location.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const ENRICH_PATH = join(ROOT, "data", "enrichments.json");
const WRITE = process.argv.includes("--write");

const seen = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
const enrich = existsSync(ENRICH_PATH) ? JSON.parse(readFileSync(ENRICH_PATH, "utf-8")) : {};

let total = 0, alreadyStructured = 0, gotCity = 0, restructured = 0, stillUnknown = 0, hybridUnclear = 0;
const unresolved = [];

function pickBest(...locs) {
  // Higher = more specific. A metro hit beats Other US/Other Intl beats no-city.
  const score = (l) => {
    if (!l) return -1;
    let s = 0;
    if (l.city) s += 2;
    if (l.workplace !== "unknown") s += 1;
    if (l.city) {
      const c = clusterForLocation(l);
      if (c !== "other_us" && c !== "other_intl" && c !== "unknown" && c !== "remote") s += 1;
    }
    return s;
  };
  return locs.reduce((best, l) => (score(l) > score(best) ? l : best), { workplace: "unknown", city: null, region: null });
}

function hadCity(s) {
  if (!s) return false;
  return /,| · /.test(s) || /^(San Francisco|Chicago|Boston|Austin|NYC|New York|Hybrid NYC|Remote NYC|Atlanta|Denver|Seattle|London|Dublin|Toronto|Singapore|Mexico City)/i.test(s);
}

for (const [url, entry] of Object.entries(seen)) {
  total++;
  if (typeof entry.location_workplace === "string") { alreadyStructured++; continue; }

  const e = enrich[url] || {};
  const fromStored = parseLocationString(entry.location || "");
  const fromEnrichStr = parseLocationString(typeof e.location === "string" ? e.location : "");
  const eText = [e.verdict, e.team_context, ...(e.green_flags || []), ...(e.red_flags || [])].filter(Boolean).join(" ");
  const fromEnrichText = eText ? resolveTextLocation(entry.title || "", url, eText) : { workplace: "unknown", city: null, region: null };
  const fromTitleUrl = resolveTextLocation(entry.title || "", url, "");

  const best = pickBest(fromStored, fromEnrichStr, fromEnrichText, fromTitleUrl);
  const cluster = clusterForLocation(best);
  const flat = flattenLocation(best);

  if (best.city) gotCity++;
  if (!best.city && cluster === "unknown") {
    stillUnknown++;
    if (best.workplace === "hybrid") hybridUnclear++;
    unresolved.push({ url, title: entry.title || "", oldLocation: entry.location || "", workplace: best.workplace });
  } else if (hadCity(entry.location)) {
    restructured++;
  }

  if (WRITE) {
    entry.location = flat;
    entry.location_workplace = best.workplace;
    entry.location_city = best.city;
    entry.location_region = best.region;
  }
}

if (WRITE) {
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
}

const today = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push(`# Location backfill — ${today}${WRITE ? "" : " (DRY RUN — re-run with --write to persist)"}`);
lines.push("");
lines.push(`- Entries scanned: **${total}**`);
lines.push(`- Already structured (skipped): **${alreadyStructured}**`);
lines.push(`- Upgraded with a city anchor: **${gotCity}**`);
lines.push(`- Generic-city strings restructured: **${restructured}**`);
lines.push(`- Still unresolved (no city, cluster=unknown): **${stillUnknown}**  — of which "Hybrid (location unclear)": **${hybridUnclear}**`);
lines.push("");
if (unresolved.length) {
  lines.push(`## Unresolved (${unresolved.length}) — eyeball these`);
  lines.push("");
  lines.push("| Old location | Workplace | Title | URL |");
  lines.push("|---|---|---|---|");
  for (const u of unresolved.slice(0, 200)) {
    lines.push(`| ${u.oldLocation || "—"} | ${u.workplace} | ${u.title.replace(/\|/g, "/")} | ${u.url} |`);
  }
  if (unresolved.length > 200) lines.push(`| … | … | … | _+${unresolved.length - 200} more_ |`);
}
const report = lines.join("\n") + "\n";
console.log(report);
if (WRITE) {
  const dir = join(ROOT, "reports");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `backfill-locations-${today}.md`), report);
  console.log(`\nWrote reports/backfill-locations-${today}.md and updated data/seen-urls.json`);
}
