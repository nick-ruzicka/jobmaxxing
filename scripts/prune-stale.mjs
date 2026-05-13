#!/usr/bin/env node

/**
 * prune-stale.mjs — Remove stale roles from seen-urls.json
 *
 * Removes roles that:
 * - Were discovered 30+ days ago
 * - Have status "Discovered" (never acted on)
 * - Are not in applications.md with active status
 *
 * Does NOT remove roles with status: Applied, Interview, Evaluated, Offer
 *
 * Usage:
 *   node scripts/prune-stale.mjs           # dry run
 *   node scripts/prune-stale.mjs --apply   # write changes
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const APP_PATH = join(ROOT, "data", "applications.md");
const ENRICHMENT_PATH = join(ROOT, "data", "enrichments.json");

const STALE_DAYS = 30;
const dryRun = !process.argv.includes("--apply");

// Parse applications.md to find active roles
function getActiveUrls() {
  if (!existsSync(APP_PATH)) return new Set();
  const md = readFileSync(APP_PATH, "utf-8");
  const active = new Set();
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length < 6) continue;
    const status = (cols[5] || "").toLowerCase();
    // Keep anything that's been acted on
    if (["applied", "interview", "evaluated", "offer", "responded"].includes(status)) {
      // Try to find URL in report links or notes
      const reportLink = cols[7] || "";
      // Mark this company+role as active
      const company = (cols[2] || "").toLowerCase();
      const role = (cols[3] || "").toLowerCase();
      if (company && role) active.add(`${company}:${role}`);
    }
  }
  return active;
}

const seen = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
const enrichments = existsSync(ENRICHMENT_PATH)
  ? JSON.parse(readFileSync(ENRICHMENT_PATH, "utf-8"))
  : {};
const activeRoles = getActiveUrls();

const now = Date.now();
let pruned = 0;
let kept = 0;
const prunedEntries = [];

for (const [url, meta] of Object.entries(seen)) {
  const firstSeen = meta.firstSeen ? new Date(meta.firstSeen).getTime() : now;
  const daysSince = (now - firstSeen) / (1000 * 60 * 60 * 24);

  if (daysSince < STALE_DAYS) {
    kept++;
    continue;
  }

  // Check if this role is in applications.md with active status
  const company = (meta.company || "").toLowerCase();
  const title = (meta.title || "").toLowerCase();
  const isActive = [...activeRoles].some((key) => {
    const [co, ro] = key.split(":");
    return company.includes(co) || co.includes(company) ||
           title.includes(ro) || ro.includes(title);
  });

  if (isActive) {
    kept++;
    continue;
  }

  // Check enrichment — if it has a high fit_score, keep it
  const enrichment = enrichments[url];
  if (enrichment && !enrichment.error && enrichment.fit_score >= 7) {
    kept++;
    continue;
  }

  // Prune
  prunedEntries.push({
    company: meta.company || "Unknown",
    title: (meta.title || "").slice(0, 40),
    firstSeen: meta.firstSeen,
    days: Math.round(daysSince),
  });
  pruned++;

  if (!dryRun) {
    delete seen[url];
    if (enrichments[url]) delete enrichments[url];
  }
}

console.log(`\n=== Prune Stale Roles ===\n`);
console.log(`  Total: ${Object.keys(seen).length + pruned}`);
console.log(`  Kept: ${kept + Object.keys(seen).length - pruned}`);
console.log(`  Pruned: ${pruned} (${STALE_DAYS}+ days, no activity, fit_score < 7)`);
console.log();

if (pruned > 0) {
  console.log(`  Would remove:`);
  prunedEntries
    .sort((a, b) => b.days - a.days)
    .slice(0, 20)
    .forEach((e) => {
      console.log(`    ${e.days}d  ${e.company.padEnd(20)} ${e.title}`);
    });
  if (pruned > 20) console.log(`    ... and ${pruned - 20} more`);
}

if (dryRun) {
  console.log(`\n  DRY RUN — run with --apply to save.\n`);
} else {
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
  writeFileSync(ENRICHMENT_PATH, JSON.stringify(enrichments, null, 2) + "\n");
  console.log(`\n  Changes saved.\n`);
}
