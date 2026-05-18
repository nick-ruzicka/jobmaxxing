#!/usr/bin/env node
// One-shot: repair existing seen-urls.json entries from builtin.com whose
// location_city is null (or location_workplace="unknown") — typically because
// the BuiltIn search-page CARD lacked a single-city signal ("5 Locations").
// Re-fetches the JOB page, parses JSON-LD, picks the user's preferred city
// from any jobLocation array, replaces structured fields.
//
// Mirror of scripts/repair-ats-locations.mjs. Run once after scan-jobs.mjs
// STEP 0b ships, then archive alongside the other one-shots.
//
// Caveat: BuiltIn rate-limits aggressively. A 400+ URL bulk run will likely
// hit HTTP 403 partway. The output reports `upgrade_failed` — re-run later
// (usually within an hour) to pick up the failures.
//
// Usage:  node scripts/repair-builtin-locations.mjs            # dry run
//         node scripts/repair-builtin-locations.mjs --write    # persist

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { repairBuiltinLocations } from "./lib/repair-builtin-locations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const WRITE = process.argv.includes("--write");

// NYC-bias preferences — matches scan-jobs.mjs STEP 0b. Future: derive from
// config/user-context.yaml so this stays in one place.
const PREFERENCES = {
  preferred: ["new york", "brooklyn", "queens", "jersey city", "hoboken"],
  avoid: ["san francisco", "los angeles", "chicago", "austin", "seattle"],
};

const seen = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
const totalEntries = Object.keys(seen).length;

const { stats, previews } = await repairBuiltinLocations(seen, {
  dryRun: !WRITE,
  preferences: PREFERENCES,
});

console.log(`\n=== repair-builtin-locations — ${WRITE ? "WRITE" : "DRY RUN"} ===`);
console.log(`seen-urls entries scanned:        ${stats.scanned} (file has ${totalEntries})`);
console.log(`skipped (non-BuiltIn URL):        ${stats.skipped_non_builtin}`);
console.log(`skipped (workplace+city already): ${stats.skipped_already_known}`);
console.log(`upgrade failed (403/404/network): ${stats.upgrade_failed}`);
console.log(`upgraded:                         ${stats.upgraded}`);

if (!WRITE && previews.length > 0) {
  console.log(`\n--- Preview (first 15) ---`);
  for (const p of previews.slice(0, 15)) {
    const u = p.upgraded;
    console.log(`\n  ${p.url}`);
    console.log(`    company:            ${u.company}`);
    console.log(`    title:              ${u.title}`);
    console.log(`    location_workplace: ${u.location_workplace}`);
    console.log(`    location_city:      ${u.location_city ?? "(no city)"}`);
    console.log(`    comp:               ${u.comp || "(no comp)"}`);
    if (u.all_locations && u.all_locations.length > 1) {
      console.log(`    multi-office:       ${u.all_locations.map(l => l.city || "?").join(", ")}`);
    }
  }
  if (previews.length > 15) {
    console.log(`\n  …and ${previews.length - 15} more`);
  }
  console.log(`\nRe-run with --write to persist.`);
}

if (stats.upgrade_failed > 0) {
  console.log(`\nNote: ${stats.upgrade_failed} fetches failed (commonly BuiltIn 403 rate-limiting).`);
  console.log(`      Re-run the script later to pick up the failures.`);
}

if (WRITE && stats.upgraded > 0) {
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
  console.log(`\nWrote ${SEEN_PATH}`);
}
