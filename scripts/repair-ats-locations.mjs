#!/usr/bin/env node
// One-shot: repair existing seen-urls.json entries whose location_workplace is
// "unknown" but whose URL is from a known ATS (Ashby, Greenhouse). Re-fetches the
// posting-API for each, replaces title/company/location/comp from structured
// fields, marks `location_upgraded_from: "ats_api"`.
//
// Run once after scan-jobs.mjs STEP 0 ships. Then archive.
//
// Usage:  node scripts/repair-ats-locations.mjs            # dry run, prints diff
//         node scripts/repair-ats-locations.mjs --write    # persist

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { repairAtsLocations } from "./lib/repair-ats-locations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const WRITE = process.argv.includes("--write");

const seen = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
const before = Object.keys(seen).length;

const { stats, previews } = await repairAtsLocations(seen, { dryRun: !WRITE });

console.log(`\n=== repair-ats-locations — ${WRITE ? "WRITE" : "DRY RUN"} ===`);
console.log(`seen-urls entries scanned:       ${stats.scanned} (file has ${before})`);
console.log(`skipped (non-ATS URL):           ${stats.skipped_non_ats}`);
console.log(`skipped (workplace already set): ${stats.skipped_already_known}`);
console.log(`upgrade failed (404/network):    ${stats.upgrade_failed}`);
console.log(`upgraded:                        ${stats.upgraded}`);

if (!WRITE && previews.length > 0) {
  console.log(`\n--- Preview (first 10) ---`);
  for (const p of previews.slice(0, 10)) {
    console.log(`\n  ${p.url}`);
    console.log(`    company:            ${p.upgraded.company}`);
    console.log(`    title:              ${p.upgraded.title}`);
    console.log(`    location_workplace: ${p.upgraded.location_workplace}`);
    console.log(`    location_city:      ${p.upgraded.location_city}`);
    console.log(`    comp:               ${p.upgraded.comp}`);
  }
  if (previews.length > 10) {
    console.log(`\n  …and ${previews.length - 10} more`);
  }
  console.log(`\nRe-run with --write to persist.`);
}

if (WRITE && stats.upgraded > 0) {
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
  console.log(`\nWrote ${SEEN_PATH}`);
}
