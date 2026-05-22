#!/usr/bin/env node

/**
 * backfill-adjusted-scores.mjs — apply the G4 scoring layer to every
 * enriched role with an archetype tag and capture the diff.
 *
 * For each role:
 *   - score_base = fit_score (unchanged source of truth)
 *   - score_adjusted = base + location + comp + archetype + soft + anti
 *   - score_adjustments = per-source itemization (audit trail)
 *   - score_disqualified = hard-no match
 *
 * Prints a pre/post top-10 diff so the user can verify the layer works
 * as intended.
 *
 * Usage:
 *   node scripts/backfill-adjusted-scores.mjs           # apply + save
 *   node scripts/backfill-adjusted-scores.mjs --dry-run # show diff only
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { adjustScore } from "./lib/scoring-layer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const ENRICHMENT_PATH = join(ROOT, "data", "enrichments.json");

const DRY_RUN = process.argv.includes("--dry-run");
const TOP_N = 10;

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

function topN(entries, n, scoreKey) {
  return entries
    .filter((e) => e[1][scoreKey] != null)
    .sort((a, b) => (b[1][scoreKey] ?? 0) - (a[1][scoreKey] ?? 0))
    .slice(0, n);
}

function main() {
  const seen = JSON.parse(readFileSync(SEEN_PATH, "utf8"));
  const enrichments = JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"));

  // Capture pre-state top-10 by fit_score
  const preEntries = Object.entries(enrichments).filter(
    ([_url, e]) => typeof e.fit_score === "number",
  );
  const preTop = topN(preEntries, TOP_N, "fit_score");

  let processed = 0;
  let disqualified = 0;
  let bigMoves = 0; // |adjusted - base| >= 2
  let maxSingleSourceDelta = 0;
  // Mirror map used during dry-run to compute post-state without writing.
  const adjustedShadow = new Map();

  for (const [url, entry] of preEntries) {
    if (!entry.archetype_primary) continue;
    const seenEntry = seen[url] || {};
    const role = {
      title: seenEntry.title || entry.title || "",
      company: seenEntry.company || entry.company || "",
      description: synthesizeDescription(entry),
      ats: seenEntry.source || "",
      comp_range: entry.comp_range || "",
      comp_source: entry.comp_source,
      verdict: entry.verdict || "",
      red_flags: Array.isArray(entry.red_flags) ? entry.red_flags : [],
      location_workplace: seenEntry.location_workplace || "",
      location_city: seenEntry.location_city || "",
      location_region: seenEntry.location_region || "",
    };

    const result = adjustScore(
      entry.fit_score,
      role,
      entry.archetype_primary,
      entry.archetype_secondary ?? [],
    );

    for (const a of result.adjustments) {
      if (Math.abs(a.delta) > maxSingleSourceDelta) {
        maxSingleSourceDelta = Math.abs(a.delta);
      }
    }

    if (Math.abs((result.adjusted_score ?? 0) - (entry.fit_score ?? 0)) >= 2) bigMoves++;
    if (result.disqualified) disqualified++;

    const updated = {
      ...entry,
      score_base: entry.fit_score,
      score_adjusted: result.adjusted_score,
      score_adjustments: result.adjustments,
      score_disqualified: result.disqualified,
      score_disqualification_reason: result.disqualification_reason,
      score_clamp_reason: result.clamp_reason ?? null,
      score_adjusted_at: new Date().toISOString(),
    };

    if (!DRY_RUN) {
      enrichments[url] = updated;
    } else {
      adjustedShadow.set(url, updated);
    }

    processed++;
  }

  if (!DRY_RUN) {
    writeFileSync(ENRICHMENT_PATH, JSON.stringify(enrichments, null, 2) + "\n");
  }

  // Capture post-state top-10 by adjusted score
  const postSource = DRY_RUN
    ? Array.from(adjustedShadow.entries())
    : Object.entries(enrichments).filter(([_, e]) => typeof e.score_adjusted === "number");
  const postTop = topN(postSource, TOP_N, "score_adjusted");

  const preIds = new Set(preTop.map(([url]) => url));
  const postIds = new Set(postTop.map(([url]) => url));

  console.log("");
  console.log("=== scoring layer backfill ===");
  console.log(`  processed: ${processed}`);
  console.log(`  disqualified (hard-no): ${disqualified}`);
  console.log(`  big moves (|delta| >= 2.0): ${bigMoves}`);
  console.log(`  max single-source |delta|: ${maxSingleSourceDelta}`);
  if (maxSingleSourceDelta > 75) {
    console.log(`  ⚠️  WARNING: single-source delta exceeded 75 (Task G surprise rule)`);
  }
  console.log("");
  console.log("=== top-10 BEFORE (by fit_score) ===");
  for (const [url, e] of preTop) {
    const seenE = seen[url] || {};
    console.log(`  ${e.fit_score}/10  ${seenE.title?.slice(0, 50) ?? ""} @ ${seenE.company ?? ""}`);
  }
  console.log("");
  console.log("=== top-10 AFTER (by score_adjusted) ===");
  for (const [url, e] of postTop) {
    const seenE = seen[url] || {};
    const marker = preIds.has(url) ? "  " : "↑ ";
    console.log(
      `${marker}${e.score_adjusted}/10 (base ${e.score_base}) ${seenE.title?.slice(0, 50) ?? ""} @ ${seenE.company ?? ""}`,
    );
  }
  console.log("");
  console.log("=== ROLES THAT DROPPED OUT OF TOP-10 ===");
  for (const [url, e] of preTop) {
    if (!postIds.has(url)) {
      const seenE = seen[url] || {};
      const newScore = DRY_RUN
        ? adjustedShadow.get(url)?.score_adjusted ?? "?"
        : enrichments[url]?.score_adjusted ?? "?";
      console.log(`  ${e.fit_score} → ${newScore}  ${seenE.title?.slice(0, 50) ?? ""} @ ${seenE.company ?? ""}`);
    }
  }
  console.log("");
  console.log("=== ROLES THAT JUMPED INTO TOP-10 ===");
  for (const [url, e] of postTop) {
    if (!preIds.has(url)) {
      const seenE = seen[url] || {};
      console.log(`  ${e.score_base} → ${e.score_adjusted}  ${seenE.title?.slice(0, 50) ?? ""} @ ${seenE.company ?? ""}`);
    }
  }
  if (DRY_RUN) console.log("\n  (DRY RUN — enrichments.json not modified)");
}

main();
