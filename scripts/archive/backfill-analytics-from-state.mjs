#!/usr/bin/env node
/**
 * backfill-analytics-from-state.mjs — reconstruct daily rollups from the
 * existing state files (seen-urls.json, enrichments.json, applications.md)
 * for dates predating the event log.
 *
 * What we CAN reconstruct (sets data_completeness='reconstructed'):
 *   - Per-source role_discovered counts (from seen-urls firstSeen + URL host)
 *   - Per-source enrich.complete counts with fit_score (from enrichments timestamp)
 *   - Per-source fit_distribution and hit_rate_fit_6plus
 *   - Per-source applications_attributed (from applications.md cross-ref)
 *
 * What we CANNOT reconstruct (left as 0/null in the rollup):
 *   - HTTP error counts
 *   - Exact Claude token usage / cost
 *   - Exa cost
 *   - Tier durations / runs
 *   - Dedup skips, filter rejections, anomaly events
 *
 * Usage:
 *   node scripts/backfill-analytics-from-state.mjs               # last 60 days
 *   node scripts/backfill-analytics-from-state.mjs --days 90
 *   node scripts/backfill-analytics-from-state.mjs --since 2026-03-01
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeRollup, detectAnomalies } from "./lib/analytics-rollup.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const ROLLUPS_DIR = join(DATA_DIR, "analytics", "daily");

function parseArgs(argv) {
  const args = { days: 60, since: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") args.days = parseInt(argv[++i], 10);
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage:\n  --days N           reconstruct last N days (default 60)\n  --since YYYY-MM-DD reconstruct from this date through today",
      );
      process.exit(0);
    }
  }
  return args;
}

function readJsonSafe(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function ensureDir(path) {
  const d = dirname(path);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function dateRange({ days, since }) {
  const today = new Date();
  const out = [];
  if (since) {
    const start = new Date(`${since}T00:00:00Z`);
    const cur = new Date(start);
    while (cur <= today) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      out.push(d.toISOString().slice(0, 10));
    }
  }
  return out;
}

/**
 * Convert seen-urls.json + enrichments.json into a synthetic event stream,
 * then group by date. We use the existing computeRollup() so the shape is
 * identical to event-log-derived rollups (just with the cost/HTTP fields zero).
 */
function reconstructEventsByDate(seenUrls, enrichments) {
  const byDate = new Map(); // date -> events[]
  const push = (date, evt) => {
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(evt);
  };

  // Discovery events from seen-urls (firstSeen is YYYY-MM-DD).
  for (const [url, meta] of Object.entries(seenUrls)) {
    const date = (meta?.firstSeen || "").slice(0, 10);
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    const host = safeHost(url);
    if (!host) continue;
    push(date, {
      type: "scrape.role_discovered",
      ts: `${date}T00:00:00.000Z`,
      url,
      host,
      source: meta?.source,
      title: meta?.title,
      company: meta?.company,
    });
  }

  // Enrichment events from enrichments.json (timestamp is full ISO).
  for (const [url, meta] of Object.entries(enrichments)) {
    if (!meta?.timestamp) continue;
    const date = meta.timestamp.slice(0, 10);
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    const host = safeHost(url);
    if (!host) continue;
    if (meta.error) {
      push(date, {
        type: "enrich.error",
        ts: meta.timestamp,
        url,
        host,
        error: meta.error,
      });
    } else if (typeof meta.fit_score === "number") {
      push(date, {
        type: "enrich.complete",
        ts: meta.timestamp,
        url,
        host,
        fit_score: meta.fit_score,
        comp_range: meta.comp_range,
      });
    }
  }
  return byDate;
}

/**
 * Parse applications.md to extract per-application company name. Cross-reference
 * with seen-urls.json to attribute applications to source hosts.
 */
function buildApplicationAttribution(applicationsMdPath, seenUrls) {
  if (!existsSync(applicationsMdPath)) return new Map();
  const md = readFileSync(applicationsMdPath, "utf8");
  // Rows look like: | # | DATE | COMPANY | ROLE | SCORE | STATUS | ... |
  // Parse loosely — pick out rows where status is Applied/Interview/Offer/Rejected.
  const APPLIED_STATES = new Set(["Applied", "Interview", "Offer", "Rejected"]);
  const apps = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|") || line.startsWith("|---")) continue;
    const cells = line.split("|").map((s) => s.trim());
    if (cells.length < 7) continue;
    const [, , date, company, , , status] = cells;
    if (!date?.match(/^\d{4}-\d{2}-\d{2}/)) continue;
    if (!APPLIED_STATES.has(status)) continue;
    apps.push({ date: date.slice(0, 10), company: company?.toLowerCase().trim() });
  }
  // For each application, find seen-urls whose company matches → take the host.
  const attrByDate = new Map(); // date -> { host -> count }
  for (const app of apps) {
    const matchingHosts = new Set();
    for (const [url, meta] of Object.entries(seenUrls)) {
      const seenCo = (meta?.company || "").toLowerCase().trim();
      if (!seenCo || !app.company) continue;
      // Match on 6-char prefix (per SOURCE_PRIORITY.md convention)
      if (seenCo.slice(0, 6) === app.company.slice(0, 6)) {
        const host = safeHost(url);
        if (host) matchingHosts.add(host);
      }
    }
    if (!attrByDate.has(app.date)) attrByDate.set(app.date, new Map());
    const inner = attrByDate.get(app.date);
    for (const host of matchingHosts) {
      inner.set(host, (inner.get(host) || 0) + 1);
    }
  }
  return attrByDate;
}

function applyAttribution(rollup, attrForDate) {
  if (!attrForDate || attrForDate.size === 0) return;
  let total = 0;
  for (const [host, count] of attrForDate) {
    if (!rollup.by_source[host]) {
      // Create a thin record so the attribution still surfaces.
      rollup.by_source[host] = {
        roles_discovered: 0,
        roles_filter_rejected: 0,
        roles_enriched: 0,
        roles_fit_6plus: 0,
        roles_quarantine_skipped: 0,
        enrich_errors: 0,
        parse_success: 0,
        parse_failure: 0,
        http_requests: 0,
        http_error_count: 0,
        claude_calls: 0,
        claude_tokens_input: 0,
        claude_tokens_output: 0,
        claude_cost_usd: 0,
        exa_cost_usd: 0,
        fit_distribution: { "0-3": 0, "4-6": 0, "7-8": 0, "9-10": 0 },
        hit_rate_fit_6plus: 0,
        applications_attributed: 0,
      };
    }
    rollup.by_source[host].applications_attributed =
      (rollup.by_source[host].applications_attributed || 0) + count;
    total += count;
  }
  rollup.totals.applications_attributed = total;
}

function writeRollup(date, rollup) {
  const file = join(ROLLUPS_DIR, `${date}.json`);
  ensureDir(file);
  writeFileSync(file, JSON.stringify(rollup, null, 2));
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

function daysAgoFrom(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv);
  const dates = dateRange(args);
  console.log(`Backfilling ${dates.length} days (${dates[0]} to ${dates[dates.length - 1]})`);

  const seenUrls = readJsonSafe(join(DATA_DIR, "seen-urls.json"), {});
  const enrichments = readJsonSafe(join(DATA_DIR, "enrichments.json"), {});
  const applicationsMd = join(DATA_DIR, "applications.md");

  console.log(`  seen-urls: ${Object.keys(seenUrls).length} URLs`);
  console.log(`  enrichments: ${Object.keys(enrichments).length} entries`);

  const eventsByDate = reconstructEventsByDate(seenUrls, enrichments);
  const attrByDate = buildApplicationAttribution(applicationsMd, seenUrls);

  let writtenWithData = 0;
  let writtenEmpty = 0;
  let preservedExisting = 0;

  for (const date of dates) {
    // Don't clobber an event-log-derived rollup with a reconstructed one.
    const existing = readRollupSafe(date);
    if (existing && existing.data_completeness === "full") {
      preservedExisting++;
      continue;
    }
    const events = eventsByDate.get(date) || [];
    if (events.length === 0 && !(attrByDate.get(date)?.size > 0)) {
      writtenEmpty++;
      writeRollup(date, {
        date,
        generated_at: new Date().toISOString(),
        data_completeness: "no_data",
        totals: emptyTotals(),
        by_source: {},
        by_tier: {},
        anomalies: [],
      });
      continue;
    }
    const rollup = computeRollup(events, { date });
    rollup.data_completeness = "reconstructed";

    applyAttribution(rollup, attrByDate.get(date));

    // Anomaly detection still runs but its quality is limited by missing cost data.
    const prior = [];
    for (let i = 1; i <= 7; i++) {
      const p = readRollupSafe(daysAgoFrom(date, i));
      if (p) prior.push(p);
    }
    rollup.anomalies = detectAnomalies(rollup, prior);

    writeRollup(date, rollup);
    writtenWithData++;
  }

  console.log(
    `\nDone. ${writtenWithData} reconstructed, ${writtenEmpty} no-data stubs, ${preservedExisting} full rollups preserved.`,
  );
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

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
