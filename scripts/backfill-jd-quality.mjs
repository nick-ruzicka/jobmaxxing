#!/usr/bin/env node

/**
 * backfill-jd-quality.mjs — apply assessVerdictForExisting() to every
 * enrichment that doesn't already carry an enrichment_quality field.
 *
 * The live filter in scripts/enrich-roles.mjs uses assessJdQuality() against
 * actual JD text — but JD text isn't stored on existing enrichments. This
 * retroactive marker uses Claude's stored `verdict` as a proxy signal to
 * catch what slipped through.
 *
 * Usage:
 *   node scripts/backfill-jd-quality.mjs           # apply + save
 *   node scripts/backfill-jd-quality.mjs --dry-run # report counts only
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { assessVerdictForExisting } from "./lib/jd-quality-filter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENRICHMENT_PATH = join(ROOT, "data", "enrichments.json");

const DRY_RUN = process.argv.includes("--dry-run");

function main() {
  const enrichments = JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"));

  let processed = 0;
  let alreadyMarked = 0;
  const newlyMarked = {
    rejected_no_section_markers: 0,
    rejected_course: 0,
    rejected_press_release: 0,
  };

  for (const [url, e] of Object.entries(enrichments)) {
    if (e.error) continue;
    if (e.enrichment_quality) {
      alreadyMarked++;
      continue;
    }
    const reason = assessVerdictForExisting(e.verdict);
    if (reason) {
      newlyMarked[reason] = (newlyMarked[reason] || 0) + 1;
      if (!DRY_RUN) {
        enrichments[url] = {
          ...e,
          enrichment_quality: reason,
          enrichment_quality_assessed_at: new Date().toISOString(),
        };
      }
      processed++;
    }
  }

  // Also mark non-rejected enrichments as enrichment_quality: ok so the
  // Filtered tab can count both sides cleanly.
  if (!DRY_RUN) {
    for (const [url, e] of Object.entries(enrichments)) {
      if (e.error) continue;
      if (e.enrichment_quality) continue;
      enrichments[url] = {
        ...e,
        enrichment_quality: "ok",
        enrichment_quality_assessed_at: new Date().toISOString(),
      };
    }
    writeFileSync(ENRICHMENT_PATH, JSON.stringify(enrichments, null, 2) + "\n");
  }

  const total = Object.values(enrichments).filter((e) => !e.error).length;
  console.log("");
  console.log("=== JD quality backfill ===");
  console.log(`  enrichments scanned: ${total}`);
  console.log(`  already marked (skipped): ${alreadyMarked}`);
  console.log(`  newly marked rejected: ${processed}`);
  for (const [k, v] of Object.entries(newlyMarked)) {
    if (v > 0) console.log(`    ${k}: ${v}`);
  }
  const pct = total > 0 ? ((processed / total) * 100).toFixed(1) : 0;
  console.log(`  rejection rate: ${pct}%`);
  if (DRY_RUN) console.log("\n  (DRY RUN — enrichments.json not modified)");
}

main();
