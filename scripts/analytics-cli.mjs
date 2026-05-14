#!/usr/bin/env node
/**
 * analytics-cli.mjs — terminal-first analytics inspector.
 *
 * Reads from data/analytics/daily/*.json (produced by
 * generate-analytics-rollup.mjs and backfill-analytics-from-state.mjs).
 *
 * Subcommands:
 *   summary       — 30-day at-a-glance: totals, KPIs
 *   sources       — top sources by volume / hit rate / cost
 *   anomalies     — active anomalies from the last 7 days
 *   cost          — cost breakdown
 *   source <host> — deep-dive on one source
 *
 * No dependencies. Uses raw ANSI codes for color (avoids adding `chalk`).
 *
 * Usage:
 *   npm run analytics summary
 *   npm run analytics sources --range 30d
 *   npm run analytics anomalies
 *   node scripts/analytics-cli.mjs source builtin.com --range 60d
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const ROLLUPS_DIR = join(PROJECT_ROOT, "data", "analytics", "daily");

// -----------------------------------------------------------------------------
// ANSI
// -----------------------------------------------------------------------------

const NO_COLOR = process.env.NO_COLOR === "1" || !process.stdout.isTTY;
const c = NO_COLOR
  ? Object.fromEntries(["bold", "dim", "red", "green", "yellow", "blue", "cyan", "magenta", "reset"].map((k) => [k, (s) => s]))
  : {
      bold: (s) => `\x1b[1m${s}\x1b[22m`,
      dim: (s) => `\x1b[2m${s}\x1b[22m`,
      red: (s) => `\x1b[31m${s}\x1b[39m`,
      green: (s) => `\x1b[32m${s}\x1b[39m`,
      yellow: (s) => `\x1b[33m${s}\x1b[39m`,
      blue: (s) => `\x1b[34m${s}\x1b[39m`,
      cyan: (s) => `\x1b[36m${s}\x1b[39m`,
      magenta: (s) => `\x1b[35m${s}\x1b[39m`,
      reset: (s) => s,
    };

// -----------------------------------------------------------------------------
// Args
// -----------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { cmd: argv[2] || "summary", positional: [], range: "30d" };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--range" || a === "-r") args.range = argv[++i];
    else if (a === "--help" || a === "-h") printHelp();
    else args.positional.push(a);
  }
  return args;
}

function printHelp() {
  console.log(
    `analytics-cli.mjs — terminal inspector for /analytics rollups

usage:
  node scripts/analytics-cli.mjs <command> [--range 7d|30d|60d|90d]

commands:
  summary               30-day at-a-glance
  sources               top sources by various metrics
  anomalies             active anomalies (default range: 7d)
  cost                  cost breakdown
  source <host>         deep-dive on one source

flags:
  --range, -r           time window (default: 30d for most, 7d for anomalies)
  --help, -h            this message`,
  );
  process.exit(0);
}

// -----------------------------------------------------------------------------
// Rollup loading
// -----------------------------------------------------------------------------

function rangeDays(range) {
  return { "7d": 7, "30d": 30, "60d": 60, "90d": 90 }[range] || 30;
}

function dateOffset(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function loadRollups(range) {
  const n = rangeDays(range);
  const dates = [];
  for (let i = n - 1; i >= 0; i--) dates.push(dateOffset(i));
  const out = [];
  for (const d of dates) {
    const f = join(ROLLUPS_DIR, `${d}.json`);
    if (!existsSync(f)) continue;
    try {
      out.push(JSON.parse(readFileSync(f, "utf8")));
    } catch {
      /* skip */
    }
  }
  return out;
}

function loadAllRollups() {
  if (!existsSync(ROLLUPS_DIR)) return [];
  const files = readdirSync(ROLLUPS_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(ROLLUPS_DIR, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

function fmtInt(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}
function fmtUsd(n) {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}
function pct(n) {
  return `${Math.round(n * 100)}%`;
}

function table(headers, rows, { align = [] } = {}) {
  const cols = headers.length;
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((m, r) => Math.max(m, String(r[i] ?? "").length), 0);
    return Math.max(String(h).length, maxRow);
  });
  const sep = "  ";
  const renderRow = (cells, color) =>
    cells
      .map((cell, i) => {
        const s = String(cell ?? "");
        const a = align[i] || "left";
        const padded = a === "right" ? s.padStart(widths[i]) : s.padEnd(widths[i]);
        return color ? color(padded) : padded;
      })
      .join(sep);
  console.log(renderRow(headers, c.dim));
  for (const r of rows) console.log(renderRow(r));
}

// -----------------------------------------------------------------------------
// Aggregation (no external lib; replicates the dashboard's logic on JSON)
// -----------------------------------------------------------------------------

function aggregateTotals(rollups) {
  const t = {
    claude_cost_usd: 0,
    exa_cost_usd: 0,
    total_cost_usd: 0,
    claude_tokens_input: 0,
    claude_tokens_output: 0,
    roles_discovered: 0,
    roles_enriched: 0,
    roles_fit_6plus: 0,
    roles_fit_7plus: 0,
    applications_attributed: 0,
    auto_promotions: 0,
    date_count_with_data: 0,
  };
  for (const r of rollups) {
    if (r.data_completeness === "no_data") continue;
    t.date_count_with_data += 1;
    for (const k of Object.keys(t)) {
      if (k === "date_count_with_data") continue;
      const v = r.totals?.[k] ?? 0;
      if (typeof v === "number") t[k] += v;
    }
  }
  return t;
}

function aggregateBySource(rollups) {
  const acc = new Map();
  for (const r of rollups) {
    for (const [host, s] of Object.entries(r.by_source || {})) {
      let a = acc.get(host);
      if (!a) {
        a = {
          host,
          roles_discovered: 0,
          roles_enriched: 0,
          roles_fit_6plus: 0,
          claude_cost_usd: 0,
          exa_cost_usd: 0,
          applications_attributed: 0,
          http_error_count: 0,
        };
        acc.set(host, a);
      }
      a.roles_discovered += s.roles_discovered || 0;
      a.roles_enriched += s.roles_enriched || 0;
      a.roles_fit_6plus += s.roles_fit_6plus || 0;
      a.claude_cost_usd += s.claude_cost_usd || 0;
      a.exa_cost_usd += s.exa_cost_usd || 0;
      a.applications_attributed += s.applications_attributed || 0;
      a.http_error_count += s.http_error_count || 0;
    }
  }
  for (const a of acc.values()) {
    a.total_cost_usd = a.claude_cost_usd + a.exa_cost_usd;
    a.hit_rate = a.roles_enriched > 0 ? a.roles_fit_6plus / a.roles_enriched : 0;
    a.cost_per_high_fit = a.roles_fit_6plus > 0 ? a.total_cost_usd / a.roles_fit_6plus : null;
  }
  return Array.from(acc.values());
}

function collectAnomalies(rollups) {
  const acc = new Map();
  for (const r of rollups) {
    for (const a of r.anomalies || []) {
      const k = `${a.type}::${a.source || ""}::${a.tier || ""}`;
      const e = acc.get(k);
      if (!e) {
        acc.set(k, {
          ...a,
          first_seen: r.date,
          last_seen: r.date,
          occurrence_count: 1,
        });
      } else {
        e.last_seen = r.date;
        e.occurrence_count += 1;
      }
    }
  }
  const rank = (s) => (s === "high" ? 3 : s === "medium" ? 2 : 1);
  return Array.from(acc.values()).sort(
    (a, b) => rank(b.severity) - rank(a.severity) || b.occurrence_count - a.occurrence_count,
  );
}

// -----------------------------------------------------------------------------
// Subcommands
// -----------------------------------------------------------------------------

function cmdSummary({ range }) {
  const rollups = loadRollups(range);
  const t = aggregateTotals(rollups);
  console.log(c.bold(`\nAnalytics summary — last ${range}`));
  console.log(c.dim(`(${t.date_count_with_data}/${rollups.length} days with data)\n`));
  const lines = [
    ["Total cost", fmtUsd(t.total_cost_usd)],
    [c.dim("  Claude"), fmtUsd(t.claude_cost_usd)],
    [c.dim("  Exa"), fmtUsd(t.exa_cost_usd)],
    ["Claude tokens (in / out)", `${fmtInt(t.claude_tokens_input)} / ${fmtInt(t.claude_tokens_output)}`],
    ["Roles discovered", fmtInt(t.roles_discovered)],
    ["Roles enriched", fmtInt(t.roles_enriched)],
    ["Roles fit ≥6", fmtInt(t.roles_fit_6plus)],
    ["Roles fit ≥7", fmtInt(t.roles_fit_7plus)],
    ["Applications attributed", fmtInt(t.applications_attributed)],
    ["Auto-promotions", fmtInt(t.auto_promotions)],
    [
      c.bold("Cost / fit ≥6 role"),
      t.roles_fit_6plus > 0 ? fmtUsd(t.total_cost_usd / t.roles_fit_6plus) : "—",
    ],
    [
      c.bold("Cost / application"),
      t.applications_attributed > 0
        ? fmtUsd(t.total_cost_usd / t.applications_attributed)
        : "—",
    ],
  ];
  for (const [k, v] of lines) {
    console.log(`  ${k.padEnd(34)} ${v}`);
  }
  console.log();
}

function cmdSources({ range }) {
  const rollups = loadRollups(range);
  const all = aggregateBySource(rollups);
  console.log(c.bold(`\nSources — last ${range}\n`));

  console.log(c.cyan("By role volume:"));
  table(
    ["Host", "Roles", "Enriched", "Fit≥6", "Hit rate", "Cost"],
    all
      .sort((a, b) => b.roles_discovered - a.roles_discovered)
      .slice(0, 10)
      .map((s) => [
        s.host,
        fmtInt(s.roles_discovered),
        fmtInt(s.roles_enriched),
        fmtInt(s.roles_fit_6plus),
        s.roles_enriched > 0 ? colorByHitRate(s.hit_rate) : c.dim("—"),
        fmtUsd(s.total_cost_usd),
      ]),
    { align: ["left", "right", "right", "right", "right", "right"] },
  );

  console.log(c.cyan("\nBy hit rate (fit ≥6 / enriched, ≥5 enrichments):"));
  table(
    ["Host", "Hit rate", "Fit≥6", "Enriched"],
    all
      .filter((s) => s.roles_enriched >= 5)
      .sort((a, b) => b.hit_rate - a.hit_rate)
      .slice(0, 10)
      .map((s) => [s.host, colorByHitRate(s.hit_rate), fmtInt(s.roles_fit_6plus), fmtInt(s.roles_enriched)]),
    { align: ["left", "right", "right", "right"] },
  );

  console.log(c.cyan("\nBy application attribution:"));
  const withApps = all
    .filter((s) => s.applications_attributed > 0)
    .sort((a, b) => b.applications_attributed - a.applications_attributed)
    .slice(0, 10);
  if (withApps.length === 0) console.log(c.dim("  (no applications attributed in this range)"));
  else
    table(
      ["Host", "Apps", "Roles", "Hit rate"],
      withApps.map((s) => [
        s.host,
        fmtInt(s.applications_attributed),
        fmtInt(s.roles_discovered),
        s.roles_enriched > 0 ? colorByHitRate(s.hit_rate) : c.dim("—"),
      ]),
      { align: ["left", "right", "right", "right"] },
    );
  console.log();
}

function colorByHitRate(hr) {
  const s = pct(hr);
  if (hr >= 0.3) return c.green(s);
  if (hr >= 0.1) return c.yellow(s);
  return c.red(s);
}

function cmdAnomalies({ range }) {
  const effective = range === "30d" ? "7d" : range; // default 7d for anomalies
  const rollups = loadRollups(effective);
  const anomalies = collectAnomalies(rollups);
  console.log(c.bold(`\nAnomalies — last ${effective}\n`));
  if (anomalies.length === 0) {
    console.log(c.green("  ✓ No anomalies. Scraper is behaving."));
    console.log();
    return;
  }
  for (const a of anomalies) {
    const sev =
      a.severity === "high"
        ? c.red(c.bold("[HIGH]"))
        : a.severity === "medium"
          ? c.yellow("[MED] ")
          : c.dim("[LOW] ");
    const headline = `${sev} ${c.cyan(a.type)}${a.source ? ` · ${a.source}` : ""}${a.tier ? ` · ${a.tier}` : ""}`;
    console.log(headline);
    console.log(`         ${c.dim(a.suggested_action || "")}`);
    console.log(
      `         ${c.dim(`first ${a.first_seen} · last ${a.last_seen} · ${a.occurrence_count}× occurred`)}`,
    );
    console.log();
  }
}

function cmdCost({ range }) {
  const rollups = loadRollups(range);
  const t = aggregateTotals(rollups);
  console.log(c.bold(`\nCost — last ${range}\n`));
  console.log(
    `  ${c.bold("Total:")}    ${fmtUsd(t.total_cost_usd)}` +
      `   ${c.dim(`(Claude ${fmtUsd(t.claude_cost_usd)} + Exa ${fmtUsd(t.exa_cost_usd)})`)}`,
  );
  console.log(
    `  Tokens:   ${fmtInt(t.claude_tokens_input)} in / ${fmtInt(t.claude_tokens_output)} out`,
  );
  console.log(
    `  $ / fit≥6: ${t.roles_fit_6plus > 0 ? fmtUsd(t.total_cost_usd / t.roles_fit_6plus) : "—"}`,
  );
  console.log(
    `  $ / app:   ${t.applications_attributed > 0 ? fmtUsd(t.total_cost_usd / t.applications_attributed) : "—"}`,
  );

  const byDate = rollups
    .map((r) => ({ date: r.date, cost: r.totals?.total_cost_usd || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
  console.log(c.cyan(`\nLast ${byDate.length} days:`));
  const maxCost = Math.max(...byDate.map((d) => d.cost), 0.01);
  for (const d of byDate) {
    const barLen = Math.round((d.cost / maxCost) * 30);
    const bar = "█".repeat(barLen) + " ".repeat(30 - barLen);
    console.log(`  ${d.date}  ${c.dim(bar)}  ${fmtUsd(d.cost)}`);
  }
  console.log();
}

function cmdSource({ positional, range }) {
  if (positional.length === 0) {
    console.error("Usage: analytics-cli source <host>");
    process.exit(1);
  }
  const host = positional[0].toLowerCase();
  const rollups = loadRollups(range);
  const all = aggregateBySource(rollups);
  const found = all.find((s) => s.host === host);
  if (!found) {
    console.log(c.yellow(`\nNo data for ${host} in last ${range}.`));
    // List nearby hosts
    const nearby = all.filter((s) => s.host.includes(host) || host.includes(s.host)).slice(0, 5);
    if (nearby.length > 0) {
      console.log(c.dim("Did you mean:"));
      for (const n of nearby) console.log(`  ${n.host}  (${fmtInt(n.roles_discovered)} roles)`);
    }
    console.log();
    return;
  }
  console.log(c.bold(`\n${host} — last ${range}\n`));
  console.log(`  Roles discovered: ${fmtInt(found.roles_discovered)}`);
  console.log(`  Roles enriched:   ${fmtInt(found.roles_enriched)}`);
  console.log(`  Fit ≥6:           ${fmtInt(found.roles_fit_6plus)}`);
  console.log(
    `  Hit rate:         ${found.roles_enriched > 0 ? colorByHitRate(found.hit_rate) : c.dim("—")}`,
  );
  console.log(`  Cost:             ${fmtUsd(found.total_cost_usd)}`);
  if (found.cost_per_high_fit !== null)
    console.log(`  $/fit≥6:          ${fmtUsd(found.cost_per_high_fit)}`);
  console.log(`  Apps attributed:  ${fmtInt(found.applications_attributed)}`);
  if (found.http_error_count > 0)
    console.log(`  HTTP errors:      ${c.red(fmtInt(found.http_error_count))}`);

  // Daily breakdown
  const daily = rollups
    .map((r) => ({ date: r.date, s: r.by_source?.[host] }))
    .filter((x) => x.s)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (daily.length > 0) {
    console.log(c.cyan(`\nDaily roles_discovered:`));
    const maxV = Math.max(...daily.map((d) => d.s.roles_discovered || 0), 1);
    for (const d of daily.slice(-14)) {
      const barLen = Math.round(((d.s.roles_discovered || 0) / maxV) * 30);
      const bar = "█".repeat(barLen) + " ".repeat(30 - barLen);
      console.log(`  ${d.date}  ${c.dim(bar)}  ${fmtInt(d.s.roles_discovered || 0)}`);
    }
  }
  console.log();
}

// -----------------------------------------------------------------------------
// Dispatch
// -----------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  if (!existsSync(ROLLUPS_DIR)) {
    console.error(
      c.yellow(
        `No rollups found at ${ROLLUPS_DIR}.\nRun: npm run analytics:rollup -- --backfill 30`,
      ),
    );
    process.exit(1);
  }
  switch (args.cmd) {
    case "summary":
      return cmdSummary(args);
    case "sources":
      return cmdSources(args);
    case "anomalies":
      return cmdAnomalies(args);
    case "cost":
      return cmdCost(args);
    case "source":
      return cmdSource(args);
    case "help":
    case "--help":
      return printHelp();
    default:
      console.error(c.red(`Unknown command: ${args.cmd}`));
      printHelp();
  }
  // suppress unused-warnings (kept to make ESM happy)
  void loadAllRollups;
}

main();
