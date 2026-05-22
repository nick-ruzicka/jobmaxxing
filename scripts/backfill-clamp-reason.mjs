#!/usr/bin/env node
// backfill-clamp-reason.mjs — E4-A one-shot.
//
// Adds `score_clamp_reason` to records that are currently floor-clamped
// (score_adjusted === 0 && score_disqualified !== true) by reading their
// EXISTING persisted `score_adjustments[]` and taking the single
// largest-magnitude negative adjustment. Mirrors the live logic in
// scripts/lib/scoring-layer.mjs.
//
// CRITICAL: this does NOT re-score. It touches no score field — only ADDS
// score_clamp_reason to clamped records. Chosen over re-running
// backfill-adjusted-scores.mjs because the persisted corpus is currently stale
// vs the scoring code (re-scoring would change ~72 unrelated scores; out of
// scope for E4-A's 0-delta guarantee).
//
// Usage:
//   node scripts/backfill-clamp-reason.mjs --dry-run   # report only, no write
//   node scripts/backfill-clamp-reason.mjs             # write

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENRICHMENT_PATH = join(__dirname, "..", "data", "enrichments.json");
const DRY_RUN = process.argv.includes("--dry-run");

function clampReasonFor(entry) {
  const adj = Array.isArray(entry.score_adjustments) ? entry.score_adjustments : [];
  const negatives = adj
    .filter((a) => typeof a.delta === "number" && a.delta < 0)
    .sort((x, y) => x.delta - y.delta); // most-negative first
  if (negatives.length === 0) return null;
  return `${negatives[0].source} (${negatives[0].delta})`;
}

function main() {
  const enrichments = JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"));

  let clamped = 0;
  let reasoned = 0;
  let noNegatives = 0;
  const examples = [];

  for (const [url, entry] of Object.entries(enrichments)) {
    if (entry.score_adjusted !== 0) continue;
    if (entry.score_disqualified === true || entry.disqualified === true) continue;
    clamped++;
    const reason = clampReasonFor(entry);
    if (reason === null) {
      noNegatives++;
      continue;
    }
    // ADDITIVE ONLY — set score_clamp_reason; never touch any score field.
    entry.score_clamp_reason = reason;
    reasoned++;
    if (examples.length < 5) {
      examples.push({ company: entry.company || url.slice(-30), base: entry.score_base, reason });
    }
  }

  console.log(`clamped records (score_adjusted=0, not DQ): ${clamped}`);
  console.log(`  → score_clamp_reason written: ${reasoned}`);
  console.log(`  → skipped (no negative adjustment to attribute): ${noNegatives}`);
  console.log("examples:");
  examples.forEach((e) => console.log("  " + JSON.stringify(e)));

  if (DRY_RUN) {
    console.log("\n[dry-run] no file written.");
    return;
  }
  writeFileSync(ENRICHMENT_PATH, JSON.stringify(enrichments, null, 2) + "\n");
  console.log("\nwrote", ENRICHMENT_PATH);
}

main();
