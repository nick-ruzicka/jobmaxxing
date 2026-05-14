#!/usr/bin/env node
/**
 * generate-analytics-rollup.mjs — pre-compute daily analytics aggregates.
 *
 * Reads:   data/events/YYYY-MM-DD.jsonl (one event per line; see event-log.mjs)
 * Writes:  data/analytics/daily/YYYY-MM-DD.json (one rollup per day)
 *
 * Usage:
 *   node scripts/generate-analytics-rollup.mjs --date 2026-05-13
 *   node scripts/generate-analytics-rollup.mjs --backfill 30
 *   node scripts/generate-analytics-rollup.mjs                 # defaults to --date today
 *
 * Schema (data/analytics/daily/YYYY-MM-DD.json):
 *   {
 *     date, generated_at, data_completeness: 'full' | 'partial' | 'reconstructed' | 'no_data',
 *     totals: {
 *       tier_runs, http_requests, http_errors,
 *       claude_calls, claude_tokens_input, claude_tokens_output, claude_cost_usd,
 *       exa_calls, exa_cost_usd, total_cost_usd,
 *       roles_discovered, roles_after_dedup, roles_after_filter,
 *       roles_enriched, roles_quarantine_skipped, roles_fit_6plus, roles_fit_7plus,
 *       auto_promotions, duration_total_ms,
 *     },
 *     by_source: { <host>: { roles_discovered, roles_filter_rejected, roles_enriched,
 *                            claude_tokens, claude_cost_usd, fit_distribution,
 *                            hit_rate_fit_6plus, applications_attributed, http_error_count,
 *                            duration_ms } },
 *     by_tier:   { <tier_label>: { ... same shape ... } },
 *     anomalies: [ { type, severity, source?, tier?, ... } ],
 *   }
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeRollup, detectAnomalies, FIT_THRESHOLD } from "./lib/analytics-rollup.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const EVENTS_DIR = join(PROJECT_ROOT, "data", "events");
const ROLLUPS_DIR = join(PROJECT_ROOT, "data", "analytics", "daily");

function parseArgs(argv) {
  const args = { date: null, backfill: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") args.date = argv[++i];
    else if (a === "--backfill") args.backfill = parseInt(argv[++i], 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage:\n  --date YYYY-MM-DD            roll up one day\n  --backfill N                 roll up last N days\n  (no args)                    roll up today",
      );
      process.exit(0);
    }
  }
  return args;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function ensureDir(path) {
  const d = dirname(path);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function readEventsForDate(date) {
  const file = join(EVENTS_DIR, `${date}.jsonl`);
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const out = [];
  let badLines = 0;
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      badLines++;
    }
  }
  if (badLines > 0) {
    console.warn(`  ⚠ ${badLines} unparseable lines in ${file}`);
  }
  return out;
}

function readRollupSafe(date) {
  const file = join(ROLLUPS_DIR, `${date}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeRollup(date, rollup) {
  const file = join(ROLLUPS_DIR, `${date}.json`);
  ensureDir(file);
  writeFileSync(file, JSON.stringify(rollup, null, 2));
}

async function rollupOneDay(date) {
  const events = readEventsForDate(date);
  if (events === null) {
    // No event log for this date. Preserve any pre-existing rollup that
    // already has data (e.g. reconstructed via backfill-analytics-from-state.mjs)
    // — overwriting it with a no_data stub would silently destroy history.
    const existing = readRollupSafe(date);
    if (existing && existing.data_completeness !== "no_data") {
      return { date, status: "preserved", events: 0 };
    }
    const stub = {
      date,
      generated_at: new Date().toISOString(),
      data_completeness: "no_data",
      totals: emptyTotals(),
      by_source: {},
      by_tier: {},
      anomalies: [],
    };
    writeRollup(date, stub);
    return { date, status: "stub", events: 0 };
  }
  // Events exist — but if a 'full' rollup already exists, don't overwrite blindly
  // either. We still recompute from the events (events are the source of truth),
  // but only when there ARE events. The check above guarantees we never destroy
  // history with an empty stub.

  const rollup = computeRollup(events, { date });

  // Anomaly detection — compare against the prior 7 days of rollups if they exist.
  const priorRollups = [];
  for (let i = 1; i <= 7; i++) {
    const prior = readRollupSafe(daysAgoFrom(date, i));
    if (prior) priorRollups.push(prior);
  }
  rollup.anomalies = detectAnomalies(rollup, priorRollups);

  writeRollup(date, rollup);
  return { date, status: "ok", events: events.length, anomalies: rollup.anomalies.length };
}

function daysAgoFrom(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function emptyTotals() {
  return {
    tier_runs: 0,
    http_requests: 0,
    http_errors: 0,
    claude_calls: 0,
    claude_tokens_input: 0,
    claude_tokens_output: 0,
    claude_cost_usd: 0,
    exa_calls: 0,
    exa_cost_usd: 0,
    total_cost_usd: 0,
    roles_discovered: 0,
    roles_after_dedup: 0,
    roles_after_filter: 0,
    roles_enriched: 0,
    roles_quarantine_skipped: 0,
    roles_fit_6plus: 0,
    roles_fit_7plus: 0,
    auto_promotions: 0,
    duration_total_ms: 0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const dates = [];
  if (args.backfill && args.backfill > 0) {
    for (let i = args.backfill - 1; i >= 0; i--) dates.push(daysAgo(i));
  } else if (args.date) {
    dates.push(args.date);
  } else {
    dates.push(todayString());
  }
  console.log(`Generating rollups for ${dates.length} day(s) [fit threshold=${FIT_THRESHOLD}]`);
  let ok = 0;
  let stub = 0;
  let preserved = 0;
  for (const d of dates) {
    const r = await rollupOneDay(d);
    if (r.status === "ok") {
      ok++;
      console.log(`  ✓ ${d}  events=${r.events}  anomalies=${r.anomalies}`);
    } else if (r.status === "preserved") {
      preserved++;
      console.log(`  · ${d}  (no events; preserved existing reconstructed rollup)`);
    } else {
      stub++;
      console.log(`  · ${d}  (no events; wrote no_data stub)`);
    }
  }
  console.log(
    `\nDone. ${ok} with data, ${preserved} preserved, ${stub} new stubs.`,
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
