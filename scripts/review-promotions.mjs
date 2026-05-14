#!/usr/bin/env node
/**
 * review-promotions.mjs — human-review CLI for auto-promoted entries in
 * config/companies.yml.
 *
 * Lists every entry whose `source` starts with "auto_promoted_from_", showing the
 * (ats, slug, canonical_name, added_date, notes) inline plus per-day promotion
 * counts from data/auto-promotions/<YYYY-MM-DD>.jsonl. Read-only by default;
 * `--confirm <slug>` flips `source: 'manual_confirmed'`, `--pause <slug>`
 * sets `paused: true`, `--remove <slug>` deletes the entry.
 *
 * Usage:
 *   node scripts/review-promotions.mjs                       # list recent promotions
 *   node scripts/review-promotions.mjs --days 14             # last 14 days only
 *   node scripts/review-promotions.mjs --confirm <ats>/<slug>
 *   node scripts/review-promotions.mjs --pause   <ats>/<slug>
 *   node scripts/review-promotions.mjs --remove  <ats>/<slug>
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  readCompaniesFile,
  writeCompaniesFile,
} from "./lib/companies-load.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LOG_DIR = join(ROOT, "data", "auto-promotions");

function parseArgs(argv) {
  const out = { command: "list", days: null, target: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--confirm") {
      out.command = "confirm";
      out.target = argv[++i];
    } else if (a === "--pause") {
      out.command = "pause";
      out.target = argv[++i];
    } else if (a === "--remove") {
      out.command = "remove";
      out.target = argv[++i];
    } else if (a === "--days") {
      out.days = parseInt(argv[++i], 10);
    } else if (a === "--help" || a === "-h") {
      out.command = "help";
    }
  }
  return out;
}

function parseTarget(s) {
  if (!s || !s.includes("/")) {
    throw new Error(`expected "<ats>/<slug>", got: ${JSON.stringify(s)}`);
  }
  const [ats, slug] = s.split("/", 2);
  return { ats, slug };
}

function readJsonlSafe(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadAllPromotionLogs(daysBack = null) {
  if (!existsSync(LOG_DIR)) return [];
  const cutoff = daysBack
    ? new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString().slice(0, 10)
    : null;
  const out = [];
  for (const file of readdirSync(LOG_DIR)) {
    if (!file.endsWith(".jsonl")) continue;
    const date = file.replace(/\.jsonl$/, "");
    if (cutoff && date < cutoff) continue;
    out.push(...readJsonlSafe(join(LOG_DIR, file)));
  }
  out.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return out;
}

function commandList(opts) {
  const { entries } = readCompaniesFile();
  const promoted = entries.filter((e) => e.source.startsWith("auto_promoted_from_"));
  const confirmed = entries.filter((e) => e.source === "manual_confirmed");
  const logs = loadAllPromotionLogs(opts.days);

  console.log(`Auto-promoted entries currently in config/companies.yml: ${promoted.length}`);
  console.log(`Manually-confirmed entries:                              ${confirmed.length}`);
  console.log(
    `Promotion log entries (${opts.days ? `last ${opts.days}d` : "all-time"}):           ${logs.length}`,
  );
  console.log();

  if (promoted.length === 0) {
    console.log("(no auto-promoted entries to review)");
    return;
  }
  console.log("Pending review:");
  console.log("─".repeat(80));
  for (const e of promoted) {
    const paused = e.paused ? " [PAUSED]" : "";
    console.log(`  ${e.ats}/${e.slug}${paused}`);
    console.log(`    canonical_name: ${e.canonical_name}`);
    console.log(`    source:         ${e.source}`);
    console.log(`    added_date:     ${e.added_date}`);
    if (e.notes) console.log(`    notes:          ${e.notes}`);
    console.log();
  }

  console.log("Per-day promotion counts:");
  const byDay = new Map();
  for (const l of logs) {
    const d = (l.ts || "").slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  for (const [d, n] of [...byDay.entries()].sort()) {
    console.log(`  ${d}  ${n}`);
  }

  console.log();
  console.log("Next steps:");
  console.log("  Confirm a good promotion:  node scripts/review-promotions.mjs --confirm <ats>/<slug>");
  console.log("  Pause a noisy promotion:   node scripts/review-promotions.mjs --pause   <ats>/<slug>");
  console.log("  Remove a bad promotion:    node scripts/review-promotions.mjs --remove  <ats>/<slug>");
}

function commandMutate(opts) {
  const { ats, slug } = parseTarget(opts.target);
  const { entries, path } = readCompaniesFile();
  const idx = entries.findIndex((e) => e.ats === ats && e.slug === slug);
  if (idx === -1) {
    console.error(`No entry found for ${ats}/${slug}.`);
    process.exit(1);
  }
  const original = entries[idx];

  if (opts.command === "confirm") {
    if (!original.source.startsWith("auto_promoted_from_") && original.source !== "manual_confirmed") {
      console.error(
        `Entry ${ats}/${slug} has source=${JSON.stringify(original.source)} — only auto-promoted entries can be confirmed.`,
      );
      process.exit(1);
    }
    entries[idx] = { ...original, source: "manual_confirmed" };
    writeCompaniesFile(entries, path);
    console.log(`Confirmed: ${ats}/${slug} → source: manual_confirmed`);
  } else if (opts.command === "pause") {
    entries[idx] = { ...original, paused: true };
    writeCompaniesFile(entries, path);
    console.log(`Paused:    ${ats}/${slug} → paused: true (will be skipped on next scrape run)`);
  } else if (opts.command === "remove") {
    entries.splice(idx, 1);
    writeCompaniesFile(entries, path);
    console.log(`Removed:   ${ats}/${slug}`);
  }
}

function commandHelp() {
  const usage = `\
review-promotions — inspect and curate auto-promoted entries in config/companies.yml

Usage:
  node scripts/review-promotions.mjs                       List recent promotions
  node scripts/review-promotions.mjs --days 14             Last 14 days only
  node scripts/review-promotions.mjs --confirm <ats>/<slug>
                                                            Flip source to manual_confirmed
  node scripts/review-promotions.mjs --pause   <ats>/<slug>
                                                            Set paused: true
  node scripts/review-promotions.mjs --remove  <ats>/<slug>
                                                            Delete the entry

Logs are read from data/auto-promotions/<YYYY-MM-DD>.jsonl (created by the
auto-promotion engine in scripts/lib/promote-company.mjs).
`;
  console.log(usage);
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.command === "help") return commandHelp();
  if (opts.command === "list") return commandList(opts);
  return commandMutate(opts);
}

main();
