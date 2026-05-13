#!/usr/bin/env node

/**
 * sync-score-feedback.mjs — Feed evaluation scores back into auto-scoring
 *
 * Reads applications.md, extracts evaluation scores, and builds a
 * score-overrides.json that the auto-scorer uses to adjust future scans.
 *
 * Rules:
 * - Eval score >= 4.0/5 → boost company (auto-score +2)
 * - Eval score <= 2.5/5 → penalize company (auto-score capped at 4)
 * - Eval score <= 1.5/5 → block company (auto-score = 1)
 * - Status "Rejected" or "Discarded" → penalize
 *
 * Runs automatically after enrichment.
 *
 * Usage:
 *   node scripts/sync-score-feedback.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const APP_PATH = join(ROOT, "data", "applications.md");
const OVERRIDES_PATH = join(ROOT, "data", "score-overrides.json");

function loadOverrides() {
  if (!existsSync(OVERRIDES_PATH)) return { boost: {}, penalize: {}, block: [] };
  try {
    const data = JSON.parse(readFileSync(OVERRIDES_PATH, "utf-8"));
    return {
      boost: data.boost || {},
      penalize: data.penalize || {},
      block: data.block || [],
    };
  } catch {
    return { boost: {}, penalize: {}, block: [] };
  }
}

function parseApplications() {
  if (!existsSync(APP_PATH)) return [];
  const md = readFileSync(APP_PATH, "utf-8");
  const entries = [];

  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length < 6) continue;

    const company = cols[2] || "";
    const role = cols[3] || "";
    const scoreStr = cols[4] || "";
    const status = cols[5] || "";

    // Parse score: "4.7/5" → 4.7
    const scoreMatch = scoreStr.match(/(\d+\.?\d*)\s*\/\s*5/);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

    if (company && company !== "Company") {
      entries.push({ company, role, score, status });
    }
  }
  return entries;
}

const overrides = loadOverrides();
const entries = parseApplications();

let boosted = 0;
let penalized = 0;
let blocked = 0;

for (const entry of entries) {
  const coKey = entry.company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!coKey || coKey.length < 2) continue;

  // High score → boost
  if (entry.score !== null && entry.score >= 4.0) {
    if (!overrides.boost[coKey]) {
      overrides.boost[coKey] = {
        company: entry.company,
        score: entry.score,
        reason: `Evaluated ${entry.score}/5 for ${entry.role}`,
      };
      boosted++;
    }
  }

  // Low score → penalize
  if (entry.score !== null && entry.score <= 2.5) {
    if (!overrides.penalize[coKey]) {
      overrides.penalize[coKey] = {
        company: entry.company,
        score: entry.score,
        reason: `Evaluated ${entry.score}/5 for ${entry.role}`,
      };
      penalized++;
    }
  }

  // Very low score → block
  if (entry.score !== null && entry.score <= 1.5) {
    if (!overrides.block.includes(coKey)) {
      overrides.block.push(coKey);
      blocked++;
    }
  }

  // Rejected/Discarded status → penalize if not already
  if (["Rejected", "Discarded", "SKIP"].includes(entry.status)) {
    if (!overrides.penalize[coKey]) {
      overrides.penalize[coKey] = {
        company: entry.company,
        score: entry.score,
        reason: `Status: ${entry.status}`,
      };
      penalized++;
    }
  }
}

writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + "\n");

console.log(`\n=== Score Feedback Sync ===`);
console.log(`  Entries processed: ${entries.length}`);
console.log(`  Boosted: ${boosted} (eval >= 4.0)`);
console.log(`  Penalized: ${penalized} (eval <= 2.5 or rejected)`);
console.log(`  Blocked: ${blocked} (eval <= 1.5)`);
console.log(`  Total overrides: boost=${Object.keys(overrides.boost).length} penalize=${Object.keys(overrides.penalize).length} block=${overrides.block.length}\n`);
