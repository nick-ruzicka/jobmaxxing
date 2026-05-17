#!/usr/bin/env node

/**
 * backfill-archetypes.mjs — assign archetype tags to every existing
 * enriched role that doesn't already have them.
 *
 * Joins data/enrichments.json with data/seen-urls.json to recover role
 * title/company, synthesizes a description from the Claude analysis
 * fields, runs the classifier, and writes archetype_* fields back to
 * enrichments.json. Emits role.archetype_classified events as it goes.
 *
 * Budget-aware: stops Stage 2 disambiguation when the Claude budget hits
 * 95%. Rules-only classifications still apply (no API calls).
 *
 * Usage:
 *   node scripts/backfill-archetypes.mjs           # process all unlabeled
 *   node scripts/backfill-archetypes.mjs --limit N # cap pass
 *   node scripts/backfill-archetypes.mjs --dry-run # show summary, no writes
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { classifyArchetype } from "./lib/archetype-classifier.mjs";
import { emitEvent } from "./lib/event-writer.mjs";
import { getBudget } from "./lib/claude-budget.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const ENRICHMENT_PATH = join(ROOT, "data", "enrichments.json");

function loadEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}
function hasFlag(name) {
  return process.argv.includes(name);
}

const LIMIT = arg("--limit") ? parseInt(arg("--limit"), 10) : null;
const DRY_RUN = hasFlag("--dry-run");
const FORCE = hasFlag("--force"); // re-classify even if archetype_primary is set
const BUDGET_STOP_FRACTION = 0.95;

function synthesizeDescription(enrichment) {
  const parts = [];
  if (enrichment.verdict) parts.push(enrichment.verdict);
  if (Array.isArray(enrichment.stack) && enrichment.stack.length) {
    parts.push(`Stack: ${enrichment.stack.join(", ")}`);
  }
  if (enrichment.team_context) parts.push(enrichment.team_context);
  if (enrichment.build_component) parts.push(`Build component: ${enrichment.build_component}`);
  if (enrichment.company_stage) parts.push(`Stage: ${enrichment.company_stage}`);
  return parts.join(" \n");
}

async function main() {
  const seen = JSON.parse(readFileSync(SEEN_PATH, "utf8"));
  const enrichments = JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"));

  // Snapshot pre-state distribution for the post-run diff report
  const preDistribution = {};
  let preNullCount = 0;
  for (const e of Object.values(enrichments)) {
    if (e.error || e.enrichment_quality?.startsWith?.("rejected_")) continue;
    if (e.archetype_primary) {
      preDistribution[e.archetype_primary] = (preDistribution[e.archetype_primary] || 0) + 1;
    } else {
      preNullCount++;
    }
  }

  const targets = [];
  let skippedFiltered = 0;
  for (const [url, entry] of Object.entries(enrichments)) {
    if (entry.error) continue;
    // JD-quality-rejected: never classify
    if (entry.enrichment_quality && entry.enrichment_quality.startsWith("rejected_")) {
      skippedFiltered++;
      continue;
    }
    // Already-classified: only re-do under --force (so we can update with new
    // threshold or new archetype config without losing past work)
    if (entry.archetype_primary && !FORCE) continue;
    targets.push(url);
  }

  console.log(`backfill-archetypes: ${targets.length} target${targets.length === 1 ? "" : "s"} to classify`);
  console.log(`  (skipping ${skippedFiltered} JD-quality-rejected enrichments)`);
  if (FORCE) console.log(`  --force: re-classifying entries that already have archetype_primary`);
  if (LIMIT) {
    console.log(`  cap: --limit ${LIMIT}`);
    targets.splice(LIMIT);
  }

  const startBudget = getBudget();
  console.log(
    `  budget: ${startBudget.calls}/${startBudget.maxCalls} calls, $${startBudget.totalCostUsd.toFixed(2)}/$${startBudget.maxCostUsd}`,
  );

  let processed = 0;
  let withClaude = 0;
  let rulesOnly = 0;
  let failed = 0;
  const archetypeCounts = {};

  for (const url of targets) {
    const enr = enrichments[url];
    const seenEntry = seen[url] || {};
    const role = {
      title: seenEntry.title || enr.title || "",
      company: seenEntry.company || enr.company || "",
      description: synthesizeDescription(enr),
      ats: seenEntry.source || "",
    };

    const budget = getBudget();
    const claudeStillAllowed =
      budget.totalCostUsd < budget.maxCostUsd * BUDGET_STOP_FRACTION &&
      budget.calls < budget.maxCalls * BUDGET_STOP_FRACTION;

    try {
      const result = await classifyArchetype(role, { rulesOnly: !claudeStillAllowed });
      if (result.stage === "claude") withClaude++;
      else rulesOnly++;
      const distKey = result.primary || "(no-match)";
      archetypeCounts[distKey] = (archetypeCounts[distKey] || 0) + 1;

      if (!DRY_RUN) {
        enrichments[url] = {
          ...enr,
          archetype_primary: result.primary, // can be null under NO_MATCH_THRESHOLD
          archetype_confidence: result.confidence,
          archetype_secondary: result.secondary,
          archetype_reasoning: result.reasoning,
          archetype_classified_at: result.classified_at,
          archetype_needs_review: result.needs_review,
        };
        if (result.primary) {
          try {
            emitEvent({
              type: "role.archetype_classified",
              payload: { role_id: url, archetype: result.primary },
              source: "cli",
            });
          } catch {
            // event emission shouldn't break the pass
          }
        }
      }
      processed++;
      if (processed % 50 === 0) {
        const b = getBudget();
        console.log(
          `  ${processed}/${targets.length} processed (rules=${rulesOnly}, claude=${withClaude}, failed=${failed}); budget $${b.totalCostUsd.toFixed(2)}/${b.maxCostUsd}`,
        );
        if (!DRY_RUN) writeFileSync(ENRICHMENT_PATH, JSON.stringify(enrichments, null, 2) + "\n");
      }
    } catch (err) {
      console.warn(`  ${url}: ${err.message}`);
      failed++;
    }
  }

  if (!DRY_RUN) {
    writeFileSync(ENRICHMENT_PATH, JSON.stringify(enrichments, null, 2) + "\n");
  }

  const endBudget = getBudget();
  console.log("");
  console.log("=== backfill complete ===");
  console.log(`  processed: ${processed}`);
  console.log(`  rules-only: ${rulesOnly}`);
  console.log(`  claude-disambiguated: ${withClaude}`);
  console.log(`  failed: ${failed}`);
  console.log(`  budget consumed: ${endBudget.calls - startBudget.calls} calls, $${(endBudget.totalCostUsd - startBudget.totalCostUsd).toFixed(2)}`);
  console.log("");
  console.log("  archetype distribution (POST):");
  for (const [id, count] of Object.entries(archetypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${id}: ${count} (${((count / processed) * 100).toFixed(1)}%)`);
  }
  // Pre/post diff (only meaningful under --force re-classification)
  if (FORCE) {
    console.log("");
    console.log("  archetype distribution (PRE):");
    for (const [id, count] of Object.entries(preDistribution).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${id}: ${count}`);
    }
    console.log(`    (no-match / null primary): ${preNullCount}`);
    console.log("");
    console.log("  shift summary:");
    const allKeys = new Set([...Object.keys(preDistribution), ...Object.keys(archetypeCounts)]);
    for (const key of allKeys) {
      const pre = key === "(no-match)" ? preNullCount : preDistribution[key] || 0;
      const post = archetypeCounts[key] || 0;
      const delta = post - pre;
      if (delta !== 0) {
        const sign = delta > 0 ? "+" : "";
        console.log(`    ${key.padEnd(20)}: ${pre} → ${post} (${sign}${delta})`);
      }
    }
  }
  if (DRY_RUN) console.log("\n  (DRY RUN — enrichments.json not modified)");
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
