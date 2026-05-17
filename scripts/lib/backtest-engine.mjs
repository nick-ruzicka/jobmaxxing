// backtest-engine.mjs — apply a proposed scoring rule to a sample of recent
// roles and produce a before/after diff table. The /context preferences UI
// shows this preview before a rule edit is saved.
//
// A "rule" here is a partial override of config/user-context.yaml — same
// schema as that file, applied on top of (overriding) the current context
// for the duration of the backtest call.

import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { adjustScore, loadUserContext } from "./scoring-layer.mjs";
import { parseYaml } from "./yaml-mini.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

/**
 * Run a backtest against `sampleSize` most-recently-enriched roles.
 *
 * @param {object} opts
 * @param {object} opts.proposedRule - partial user-context overrides (location_preferences, compensation, etc.)
 * @param {number} [opts.sampleSize=30]
 * @param {object} [opts.enrichments] - inject for tests
 * @param {object} [opts.seen] - inject for tests
 * @returns {{summary: object, rows: object[]}}
 */
export function runBacktest({ proposedRule, sampleSize = 30, enrichments, seen } = {}) {
  if (!proposedRule || typeof proposedRule !== "object") {
    throw new Error("runBacktest: proposedRule (object) is required");
  }
  const allEnrichments = enrichments ?? loadEnrichments();
  const allSeen = seen ?? loadSeen();

  // Recent roles: sort by timestamp desc, filter to those that have an
  // archetype + a score (i.e., already classified + scored).
  const rolesWithArch = Object.entries(allEnrichments)
    .filter(([_url, e]) => e.archetype_primary && typeof e.fit_score === "number")
    .sort((a, b) => {
      const ta = Date.parse(a[1].timestamp || 0);
      const tb = Date.parse(b[1].timestamp || 0);
      return tb - ta;
    });

  const sample = rolesWithArch.slice(0, sampleSize);

  const baseContext = loadUserContext();
  const merged = deepMerge(structuredClone(baseContext), proposedRule);

  const rows = sample.map(([url, e]) => {
    const seenE = allSeen[url] ?? {};
    const role = {
      title: seenE.title || "",
      company: seenE.company || "",
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
    const before = adjustScore(
      e.fit_score,
      role,
      e.archetype_primary,
      e.archetype_secondary ?? [],
    );
    const after = adjustScore(
      e.fit_score,
      role,
      e.archetype_primary,
      e.archetype_secondary ?? [],
      { userContext: merged },
    );
    return {
      url,
      title: role.title,
      company: role.company,
      archetype: e.archetype_primary,
      current: before.adjusted_score,
      hypothetical: after.adjusted_score,
      delta: round(after.adjusted_score - before.adjusted_score),
    };
  });

  const deltas = rows.map((r) => r.delta);
  const improved = deltas.filter((d) => d > 0).length;
  const worsened = deltas.filter((d) => d < 0).length;
  const unchanged = deltas.filter((d) => d === 0).length;
  const avgDelta = deltas.length
    ? round(deltas.reduce((s, d) => s + d, 0) / deltas.length)
    : 0;
  const biggestMover = rows.reduce(
    (top, r) => (Math.abs(r.delta) > Math.abs(top?.delta ?? 0) ? r : top),
    null,
  );

  return {
    summary: {
      sample_size: rows.length,
      improved,
      worsened,
      unchanged,
      avg_delta: avgDelta,
      biggest_mover: biggestMover,
    },
    rows,
  };
}

/**
 * Load the backtest gate config.
 */
export function loadBacktestConfig() {
  const p = join(ROOT, "config", "backtest-config.yaml");
  return parseYaml(readFileSync(p, "utf8"));
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function loadEnrichments() {
  const p = join(ROOT, "data", "enrichments.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadSeen() {
  const p = join(ROOT, "data", "seen-urls.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

function synthesizeDescription(e) {
  const parts = [];
  if (e.verdict) parts.push(e.verdict);
  if (Array.isArray(e.stack) && e.stack.length) parts.push(`Stack: ${e.stack.join(", ")}`);
  if (e.team_context) parts.push(e.team_context);
  if (e.build_component) parts.push(`Build component: ${e.build_component}`);
  if (e.company_stage) parts.push(`Stage: ${e.company_stage}`);
  return parts.join(" \n");
}

function deepMerge(base, overlay) {
  if (overlay == null) return base;
  if (Array.isArray(overlay)) return overlay; // arrays replace, not merge
  if (typeof overlay !== "object") return overlay;
  if (typeof base !== "object" || base == null) return overlay;
  const out = { ...base };
  for (const key of Object.keys(overlay)) {
    out[key] = deepMerge(base?.[key], overlay[key]);
  }
  return out;
}

function round(n) {
  return Math.round(n * 100) / 100;
}
