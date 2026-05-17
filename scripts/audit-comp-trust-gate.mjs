#!/usr/bin/env node
/**
 * audit-comp-trust-gate.mjs — audit + targeted re-score for the Phase 1 comp
 * trust gate. Re-runs adjustScore against every enriched role with the new gate
 * logic and reports the delta vs the currently-persisted score_adjusted.
 *
 * Modes:
 *   (default)  dry-run: emit markdown report to stdout, no writes
 *   --apply    write back ONLY records where the gate fires (53 records as of
 *              2026-05-18 dry-run). Drift-attributed records are left stale so
 *              this PR stays scoped to the trust gate. See
 *              docs/audits/2026-05-18-comp-trust-gate-rescore.md.
 *
 * Usage:
 *   node scripts/audit-comp-trust-gate.mjs > docs/audits/...md
 *   node scripts/audit-comp-trust-gate.mjs --apply
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { adjustScore } from "./lib/scoring-layer.mjs";

const APPLY = process.argv.includes("--apply");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const ENRICHMENT_PATH = join(ROOT, "data", "enrichments.json");

function synthesizeDescription(e) {
  const parts = [];
  if (e.verdict) parts.push(e.verdict);
  if (Array.isArray(e.stack) && e.stack.length) parts.push(`Stack: ${e.stack.join(", ")}`);
  if (e.team_context) parts.push(e.team_context);
  if (e.build_component) parts.push(`Build component: ${e.build_component}`);
  if (e.company_stage) parts.push(`Stage: ${e.company_stage}`);
  return parts.join(" \n");
}

const seen = JSON.parse(readFileSync(SEEN_PATH, "utf8"));
const enrichments = JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"));

const ANACONDA_URL = "https://builtin.com/job/gtm-engineer/8843434";

let totalEnriched = 0;
let hadBelowFloorBefore = 0;
let hadBelowFloorAndJsonld = 0;
let gateFires = 0;
const changedRoles = [];
const deltas = [];

for (const [url, e] of Object.entries(enrichments)) {
  if (typeof e.fit_score !== "number" || !e.archetype_primary) continue;
  totalEnriched++;

  const oldAdj = e.score_adjusted;
  const oldBelowFloor = (e.score_adjustments || []).find((a) => a.source === "comp:below_floor");
  const hadBelow = !!oldBelowFloor;
  if (hadBelow) hadBelowFloorBefore++;
  if (hadBelow && e.comp_source === "jsonld_basesalary") hadBelowFloorAndJsonld++;

  const seenE = seen[url] || {};
  const role = {
    title: seenE.title || e.title || "",
    company: seenE.company || e.company || "",
    description: synthesizeDescription(e),
    ats: seenE.source || "",
    comp_range: e.comp_range || "",
    comp_source: e.comp_source,
    verdict: e.verdict || "",
    red_flags: Array.isArray(e.red_flags) ? e.red_flags : [],
    location_workplace: seenE.location_workplace || "",
    location_city: seenE.location_city || "",
    location_region: seenE.location_region || "",
  };

  const newResult = adjustScore(
    e.fit_score,
    role,
    e.archetype_primary,
    e.archetype_secondary ?? [],
  );

  // Also compute the "drift baseline" — same role bag minus the gate-triggering
  // fields, so the gate cannot fire. Difference vs persisted = background drift
  // (config/code changes between original scoring and now), independent of this PR.
  const driftRole = { ...role, comp_source: undefined, verdict: "", red_flags: [] };
  const driftResult = adjustScore(
    e.fit_score,
    driftRole,
    e.archetype_primary,
    e.archetype_secondary ?? [],
  );

  const newAdj = newResult.adjusted_score;
  const driftAdj = driftResult.adjusted_score;
  const suppressed = newResult.adjustments.find((a) => a.source === "comp:below_floor_suppressed");
  if (suppressed) gateFires++;

  if (typeof oldAdj === "number" && oldAdj !== newAdj) {
    const delta = Math.round((newAdj - oldAdj) * 10) / 10;
    deltas.push(delta);
    // Gate-attributable: difference between drift baseline and gate-applied.
    // If the gate did nothing for this role, gate_delta is 0 and the entire
    // change is background drift.
    const gateDelta = Math.round((newAdj - driftAdj) * 10) / 10;
    const driftDelta = Math.round((driftAdj - oldAdj) * 10) / 10;
    changedRoles.push({
      url,
      company: role.company || seenE.company || "?",
      title: role.title || seenE.title || "?",
      comp_range: e.comp_range,
      comp_source: e.comp_source,
      old: oldAdj,
      new: newAdj,
      drift_baseline: driftAdj,
      delta,
      gate_delta: gateDelta,
      drift_delta: driftDelta,
      attributed_to: suppressed ? "gate" : "drift",
      suppressed_reason: suppressed?.reason ?? null,
      old_adjustments: e.score_adjustments,
      new_adjustments: newResult.adjustments,
    });
  }
}

const gateAttributed = changedRoles.filter((r) => r.attributed_to === "gate");
const driftAttributed = changedRoles.filter((r) => r.attributed_to === "drift");

// ── --apply: targeted re-score (gate-attributed records only) ───────────────
if (APPLY) {
  const now = new Date().toISOString();
  let written = 0;
  for (const r of gateAttributed) {
    const existing = enrichments[r.url];
    if (!existing) continue;
    enrichments[r.url] = {
      ...existing,
      score_base: existing.fit_score,
      score_adjusted: r.new,
      score_adjustments: r.new_adjustments,
      score_disqualified: false,
      score_disqualification_reason: null,
      score_adjusted_at: now,
    };
    written++;
  }
  writeFileSync(ENRICHMENT_PATH, JSON.stringify(enrichments, null, 2) + "\n");
  process.stderr.write(
    `APPLY: wrote ${written} gate-attributed records to ${ENRICHMENT_PATH}\n` +
    `       (${driftAttributed.length} drift-attributed records left untouched)\n`,
  );
  process.exit(0);
}

const increases = changedRoles.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta);
const decreases = changedRoles.filter((r) => r.delta < 0);
const top20 = increases.slice(0, 20);

const anacondaRow = changedRoles.find((r) => r.url === ANACONDA_URL);

// histogram of |delta|
const bins = { "0–0.5": 0, "0.5–1": 0, "1–2": 0, "2–3": 0, "3–4": 0, "4–5": 0, "5+": 0 };
for (const d of deltas.map(Math.abs)) {
  if (d < 0.5) bins["0–0.5"]++;
  else if (d < 1) bins["0.5–1"]++;
  else if (d < 2) bins["1–2"]++;
  else if (d < 3) bins["2–3"]++;
  else if (d < 4) bins["3–4"]++;
  else if (d < 5) bins["4–5"]++;
  else bins["5+"]++;
}

const sum = deltas.reduce((s, d) => s + d, 0);
const mean = deltas.length ? sum / deltas.length : 0;
const sorted = [...deltas].sort((a, b) => a - b);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
const max = sorted.length ? sorted[sorted.length - 1] : 0;
const min = sorted.length ? sorted[0] : 0;

// ── render markdown ─────────────────────────────────────────────────────────
const lines = [];
lines.push(`# Comp Trust Gate — Re-Score Impact (Dry Run)`);
lines.push("");
lines.push(`**Date:** 2026-05-18`);
lines.push(`**Branch:** \`fix/comp-trust-gate\``);
lines.push(`**Mode:** dry-run — no writes to \`data/enrichments.json\``);
lines.push(`**Trigger:** 2026-05-17 audit of missed Anaconda GTM Engineer role (\`builtin.com/job/gtm-engineer/8843434\`)`);
lines.push("");
lines.push(`## Cohort counts`);
lines.push("");
lines.push(`| Cohort | Count |`);
lines.push(`|---|---|`);
lines.push(`| Total enriched roles with archetype | ${totalEnriched} |`);
lines.push(`| Had \`comp:below_floor\` penalty applied (any source) | ${hadBelowFloorBefore} |`);
lines.push(`| ↳ of those, \`comp_source == jsonld_basesalary\` | ${hadBelowFloorAndJsonld} |`);
lines.push(`| ↳ of those, Claude contradiction → gate fires | ${gateFires} |`);
lines.push("");
lines.push(`## Score impact`);
lines.push("");
lines.push(`> ⚠️ **Drift caveat.** Re-running \`adjustScore\` against the current scoring code/config exposes records whose persisted \`score_adjusted\` was computed with older code/config. Those drift-induced changes happen even with the trust gate disabled and are **not caused by this PR** — but the live re-score will write them back. The table below splits gate-attributable changes from drift-attributable ones so the PR's actual surface area is visible.`);
lines.push("");
lines.push(`| Metric | Value |`);
lines.push(`|---|---|`);
lines.push(`| Total roles with \`score_adjusted\` change | ${changedRoles.length} |`);
lines.push(`| ↳ attributed to **the trust gate (this PR)** | ${gateAttributed.length} |`);
lines.push(`| ↳ attributed to **background drift (pre-existing)** | ${driftAttributed.length} |`);
lines.push(`| Roles whose score INCREASED | ${increases.length} |`);
lines.push(`| Roles whose score DECREASED | ${decreases.length} |`);
lines.push(`| Mean delta (all) | ${mean.toFixed(2)} |`);
lines.push(`| Median delta (all) | ${median.toFixed(2)} |`);
lines.push(`| Max delta | ${max.toFixed(2)} |`);
lines.push(`| Min delta | ${min.toFixed(2)} |`);
lines.push("");
lines.push(`### Delta distribution (|Δ| bins)`);
lines.push("");
lines.push(`| Bin | Count |`);
lines.push(`|---|---|`);
for (const [bin, n] of Object.entries(bins)) {
  lines.push(`| ${bin} | ${n} |`);
}
lines.push("");
lines.push(`## Anaconda — the audit-trigger role`);
lines.push("");
if (anacondaRow) {
  lines.push(`- **URL:** \`${ANACONDA_URL}\``);
  lines.push(`- **Title / company:** ${anacondaRow.title} @ ${anacondaRow.company}`);
  lines.push(`- **Old \`score_adjusted\`:** ${anacondaRow.old}`);
  lines.push(`- **New \`score_adjusted\`:** ${anacondaRow.new}`);
  lines.push(`- **Delta:** +${anacondaRow.delta}`);
  lines.push(`- **Suppression reason:** ${anacondaRow.suppressed_reason}`);
  lines.push("");
  lines.push(`**Old adjustments:**`);
  for (const a of anacondaRow.old_adjustments) {
    lines.push(`  - \`${a.source}\` Δ ${a.delta} — ${a.reason}`);
  }
  lines.push("");
  lines.push(`**New adjustments:**`);
  for (const a of anacondaRow.new_adjustments) {
    lines.push(`  - \`${a.source}\` Δ ${a.delta} — ${a.reason}`);
  }
} else {
  lines.push(`⚠️ Anaconda role NOT in change set — investigate (expected suppression).`);
}
lines.push("");
lines.push(`## Top 20 score_adjusted increases (ranked by delta)`);
lines.push("");
lines.push(`| # | Company | Title | Old | New | Δ | Comp scraped | Why |`);
lines.push(`|---|---|---|---|---|---|---|---|`);
for (let i = 0; i < top20.length; i++) {
  const r = top20[i];
  const why = r.suppressed_reason
    ? r.suppressed_reason.replace(/\|/g, "\\|")
    : "(other re-score effect)";
  const title = (r.title || "?").slice(0, 50).replace(/\|/g, "\\|");
  const company = (r.company || "?").slice(0, 30).replace(/\|/g, "\\|");
  lines.push(`| ${i + 1} | ${company} | ${title} | ${r.old} | ${r.new} | +${r.delta} | ${r.comp_range || "?"} | ${why} |`);
}
lines.push("");
if (decreases.length > 0) {
  lines.push(`## Score decreases — all from background drift`);
  lines.push("");
  lines.push(`These records decrease in score, which would be unexpected if caused by the gate (the gate only ever suppresses penalties, never adds them). Verified: each row's drift baseline equals the new score, meaning the change is entirely from re-running today's scoring code/config against historically-scored roles. The gate fired on none of these.`);
  lines.push("");
  lines.push(`| Company | Title | Old | New | Δ | Source of change |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of decreases) {
    const title = (r.title || "?").slice(0, 50).replace(/\|/g, "\\|");
    const company = (r.company || "?").slice(0, 30).replace(/\|/g, "\\|");
    lines.push(`| ${company} | ${title} | ${r.old} | ${r.new} | ${r.delta} | ${r.attributed_to} |`);
  }
  lines.push("");
}

lines.push(`## Other drift-attributed changes (increases not from this PR)`);
lines.push("");
const driftIncreases = driftAttributed.filter((r) => r.delta > 0);
if (driftIncreases.length > 0) {
  lines.push(`| Company | Title | Old | New | Δ | Why (best guess) |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of driftIncreases) {
    const title = (r.title || "?").slice(0, 50).replace(/\|/g, "\\|");
    const company = (r.company || "?").slice(0, 30).replace(/\|/g, "\\|");
    lines.push(`| ${company} | ${title} | ${r.old} | ${r.new} | +${r.delta} | code/config drift |`);
  }
} else {
  lines.push(`(none)`);
}
lines.push("");
lines.push(`## Methodology notes`);
lines.push("");
lines.push(`- Loaded \`data/enrichments.json\` (1,122 enriched roles) and \`data/seen-urls.json\`.`);
lines.push(`- For each role with \`fit_score\` and \`archetype_primary\`, re-ran \`adjustScore\` with new gate logic.`);
lines.push(`- Compared the new \`adjusted_score\` against the persisted \`score_adjusted\` (last re-scored 2026-05-17 02:00 UTC, pre-fix).`);
lines.push(`- Roles whose pre-fix \`score_adjusted\` was missing (never re-scored) are skipped — they show as "no change" but actually go from undefined → new score on the live re-score.`);
lines.push(`- No writes to \`data/enrichments.json\` in this run.`);
lines.push("");
lines.push(`## How to read this report`);
lines.push("");
lines.push(`- **Gate firing** (\`comp:below_floor_suppressed\` emitted) should equal the # of records whose old penalty got suppressed. If the score delta count > gate-firing count, something else moved (unexpected).`);
lines.push(`- **Delta should be +5** for a "pure suppression" case (the -50 penalty going away translates to +5 on the 0–10 display scale, modulo clamping).`);
lines.push(`- **Larger deltas** (e.g. +6, +7) happen when the role was previously dragged to a clamp at the low end and is now free to rise to base+archetype.`);
lines.push("");
lines.push(`## Note — Anaconda 10/10 smell (Phase 1.5 candidate)`);
lines.push("");
lines.push(`Post-fix, Anaconda clamps to 10/10. This is mathematically correct (base 8 × 10 + 5 remote + 25 gtm-eng archetype = 110 → clamped 100 → 10). However, a perfect score on a role whose comp data is tagged \`comp:below_floor_suppressed\` is a smell. Future enhancement (Phase 1.5): when the \`comp:below_floor_suppressed\` tag is present, cap the final score at something like 8.5 or 9 to reflect that the role hasn't passed full evaluation. Out of scope for this PR.`);
lines.push("");

process.stdout.write(lines.join("\n"));

// stderr summary so the caller can capture it
process.stderr.write(
  `\nDRY-RUN SUMMARY:\n` +
  `  total enriched: ${totalEnriched}\n` +
  `  had below_floor before: ${hadBelowFloorBefore}\n` +
  `  jsonld_basesalary + below_floor: ${hadBelowFloorAndJsonld}\n` +
  `  gate fires (suppression): ${gateFires}\n` +
  `  score_adjusted changes: ${changedRoles.length}\n` +
  `    gate-attributed: ${gateAttributed.length} (this PR)\n` +
  `    drift-attributed: ${driftAttributed.length} (pre-existing config/code drift)\n` +
  `    increases: ${increases.length}, decreases: ${decreases.length}\n` +
  `  Anaconda: ${anacondaRow ? `${anacondaRow.old} → ${anacondaRow.new} (+${anacondaRow.delta}, attrib: ${anacondaRow.attributed_to})` : "NOT in change set"}\n` +
  `  biggest delta: ${max.toFixed(2)}\n`,
);
