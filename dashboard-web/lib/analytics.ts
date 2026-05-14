/**
 * Analytics data layer — reads daily rollups from disk and aggregates them.
 *
 * Designed for cheap repeated queries: each rollup file is a JSON blob a few
 * KB in size; reading 90 of them is fast enough that we don't cache. If
 * volume grows, swap in a memoized loader.
 *
 * Tested in: lib/analytics.test.ts
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { ROOT } from "./data";

export type Range = "7d" | "30d" | "60d" | "90d";
export type GroupBy = "source" | "tier" | "date";
export type DataCompleteness = "full" | "partial" | "reconstructed" | "no_data";

export interface FitDistribution {
  "0-3": number;
  "4-6": number;
  "7-8": number;
  "9-10": number;
}

export interface SourceBucket {
  roles_discovered: number;
  roles_filter_rejected: number;
  roles_enriched: number;
  roles_fit_6plus: number;
  roles_quarantine_skipped: number;
  enrich_errors: number;
  parse_success: number;
  parse_failure: number;
  http_requests: number;
  http_error_count: number;
  claude_calls: number;
  claude_tokens_input: number;
  claude_tokens_output: number;
  claude_cost_usd: number;
  exa_cost_usd: number;
  fit_distribution: FitDistribution;
  hit_rate_fit_6plus: number;
  applications_attributed?: number;
  // Added in the post-walkthrough revisions — older rollups won't have these.
  fit_score_sum?: number;
  fit_score_count?: number;
  avg_fit?: number | null;
  has_comp_count?: number;
  has_comp_coverage?: number;
}

export interface TierBucket {
  runs: number;
  duration_ms: number;
  roles_discovered: number;
  exa_calls: number;
  exa_cost_usd: number;
  last_exit_status: string | null;
}

export interface Anomaly {
  type: string;
  severity: "low" | "medium" | "high";
  source?: string;
  tier?: string;
  cost_usd?: number;
  suggested_action: string;
  [key: string]: unknown;
}

export interface DailyRollup {
  date: string;
  generated_at: string;
  data_completeness: DataCompleteness;
  totals: {
    tier_runs: number;
    http_requests: number;
    http_errors: number;
    claude_calls: number;
    claude_tokens_input: number;
    claude_tokens_output: number;
    claude_cost_usd: number;
    exa_calls: number;
    exa_cost_usd: number;
    total_cost_usd: number;
    roles_discovered: number;
    roles_after_dedup: number;
    roles_after_filter: number;
    roles_enriched: number;
    roles_quarantine_skipped: number;
    roles_fit_6plus: number;
    roles_fit_7plus: number;
    auto_promotions: number;
    duration_total_ms: number;
    roles_dedup_skipped?: number;
    applications_attributed?: number;
    fit_distribution?: FitDistribution;
    fit_score_sum?: number;
    fit_score_count?: number;
    avg_fit?: number | null;
    has_comp_count?: number;
    has_comp_coverage?: number;
  };
  by_source: Record<string, SourceBucket>;
  by_tier: Record<string, TierBucket>;
  anomalies: Anomaly[];
}

export const ROLLUPS_DIR = join(ROOT, "data", "analytics", "daily");

export function listAvailableRollupDates(): string[] {
  if (!existsSync(ROLLUPS_DIR)) return [];
  return readdirSync(ROLLUPS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function readRollup(date: string): DailyRollup | null {
  const file = join(ROLLUPS_DIR, `${date}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as DailyRollup;
  } catch {
    return null;
  }
}

export function rangeDays(range: Range): number {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "60d":
      return 60;
    case "90d":
      return 90;
  }
}

export function rangeDates(range: Range, today: string = todayString()): string[] {
  const n = rangeDays(range);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(daysAgoFrom(today, i));
  }
  return out;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoFrom(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function loadRollups(range: Range): DailyRollup[] {
  return rangeDates(range)
    .map(readRollup)
    .filter((r): r is DailyRollup => r !== null);
}

// -----------------------------------------------------------------------------
// Aggregation
// -----------------------------------------------------------------------------

export interface AggregatedTotals {
  range: Range;
  date_count: number;
  date_count_with_data: number;
  claude_cost_usd: number;
  exa_cost_usd: number;
  total_cost_usd: number;
  claude_tokens_input: number;
  claude_tokens_output: number;
  roles_discovered: number;
  roles_after_dedup: number;
  roles_after_filter: number;
  roles_enriched: number;
  roles_fit_6plus: number;
  roles_fit_7plus: number;
  roles_quarantine_skipped: number;
  auto_promotions: number;
  applications_attributed: number;
  cost_per_high_fit_role: number | null;
  cost_per_application: number | null;
  avg_fit: number | null;
  has_comp_count: number;
  has_comp_coverage: number;
}

export function aggregateTotals(rollups: DailyRollup[], range: Range): AggregatedTotals {
  const t: AggregatedTotals = {
    range,
    date_count: rollups.length,
    date_count_with_data: rollups.filter((r) => r.data_completeness !== "no_data").length,
    claude_cost_usd: 0,
    exa_cost_usd: 0,
    total_cost_usd: 0,
    claude_tokens_input: 0,
    claude_tokens_output: 0,
    roles_discovered: 0,
    roles_after_dedup: 0,
    roles_after_filter: 0,
    roles_enriched: 0,
    roles_fit_6plus: 0,
    roles_fit_7plus: 0,
    roles_quarantine_skipped: 0,
    auto_promotions: 0,
    applications_attributed: 0,
    cost_per_high_fit_role: null,
    cost_per_application: null,
    avg_fit: null,
    has_comp_count: 0,
    has_comp_coverage: 0,
  };
  let fitScoreSum = 0;
  let fitScoreCount = 0;
  for (const r of rollups) {
    t.claude_cost_usd += r.totals.claude_cost_usd;
    t.exa_cost_usd += r.totals.exa_cost_usd;
    t.total_cost_usd += r.totals.total_cost_usd;
    t.claude_tokens_input += r.totals.claude_tokens_input;
    t.claude_tokens_output += r.totals.claude_tokens_output;
    t.roles_discovered += r.totals.roles_discovered;
    t.roles_after_dedup += r.totals.roles_after_dedup;
    t.roles_after_filter += r.totals.roles_after_filter;
    t.roles_enriched += r.totals.roles_enriched;
    t.roles_fit_6plus += r.totals.roles_fit_6plus;
    t.roles_fit_7plus += r.totals.roles_fit_7plus;
    t.roles_quarantine_skipped += r.totals.roles_quarantine_skipped;
    t.auto_promotions += r.totals.auto_promotions;
    t.applications_attributed += r.totals.applications_attributed || 0;
    t.has_comp_count += r.totals.has_comp_count || 0;
    fitScoreSum += r.totals.fit_score_sum || 0;
    fitScoreCount += r.totals.fit_score_count || 0;
  }
  t.claude_cost_usd = round6(t.claude_cost_usd);
  t.exa_cost_usd = round6(t.exa_cost_usd);
  t.total_cost_usd = round6(t.total_cost_usd);
  t.cost_per_high_fit_role =
    t.roles_fit_6plus > 0 ? round6(t.total_cost_usd / t.roles_fit_6plus) : null;
  t.cost_per_application =
    t.applications_attributed > 0
      ? round6(t.total_cost_usd / t.applications_attributed)
      : null;
  t.avg_fit = fitScoreCount > 0 ? round4(fitScoreSum / fitScoreCount) : null;
  t.has_comp_coverage =
    t.roles_enriched > 0 ? round4(t.has_comp_count / t.roles_enriched) : 0;
  return t;
}

export interface SourceAggregate extends SourceBucket {
  host: string;
  total_cost_usd: number;
  cost_per_high_fit: number | null;
}

export function aggregateBySource(rollups: DailyRollup[]): SourceAggregate[] {
  const acc = new Map<string, SourceAggregate>();
  for (const r of rollups) {
    for (const [host, s] of Object.entries(r.by_source)) {
      let a = acc.get(host);
      if (!a) {
        a = {
          host,
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
          total_cost_usd: 0,
          cost_per_high_fit: null,
          fit_score_sum: 0,
          fit_score_count: 0,
          avg_fit: null,
          has_comp_count: 0,
          has_comp_coverage: 0,
        };
        acc.set(host, a);
      }
      a.roles_discovered += s.roles_discovered;
      a.roles_filter_rejected += s.roles_filter_rejected;
      a.roles_enriched += s.roles_enriched;
      a.roles_fit_6plus += s.roles_fit_6plus;
      a.roles_quarantine_skipped += s.roles_quarantine_skipped;
      a.enrich_errors += s.enrich_errors;
      a.parse_success += s.parse_success;
      a.parse_failure += s.parse_failure;
      a.http_requests += s.http_requests;
      a.http_error_count += s.http_error_count;
      a.claude_calls += s.claude_calls;
      a.claude_tokens_input += s.claude_tokens_input;
      a.claude_tokens_output += s.claude_tokens_output;
      a.claude_cost_usd += s.claude_cost_usd;
      a.exa_cost_usd += s.exa_cost_usd;
      a.applications_attributed =
        (a.applications_attributed || 0) + (s.applications_attributed || 0);
      a.fit_score_sum = (a.fit_score_sum || 0) + (s.fit_score_sum || 0);
      a.fit_score_count = (a.fit_score_count || 0) + (s.fit_score_count || 0);
      a.has_comp_count = (a.has_comp_count || 0) + (s.has_comp_count || 0);
      for (const k of ["0-3", "4-6", "7-8", "9-10"] as const) {
        a.fit_distribution[k] += s.fit_distribution[k];
      }
    }
  }
  for (const a of acc.values()) {
    a.hit_rate_fit_6plus =
      a.roles_enriched > 0 ? round4(a.roles_fit_6plus / a.roles_enriched) : 0;
    a.total_cost_usd = round6(a.claude_cost_usd + a.exa_cost_usd);
    a.cost_per_high_fit =
      a.roles_fit_6plus > 0 ? round6(a.total_cost_usd / a.roles_fit_6plus) : null;
    a.claude_cost_usd = round6(a.claude_cost_usd);
    a.exa_cost_usd = round6(a.exa_cost_usd);
    a.avg_fit =
      (a.fit_score_count || 0) > 0
        ? round4((a.fit_score_sum || 0) / (a.fit_score_count || 1))
        : null;
    a.has_comp_coverage =
      a.roles_enriched > 0 ? round4((a.has_comp_count || 0) / a.roles_enriched) : 0;
  }
  return Array.from(acc.values()).sort(
    (a, b) => b.roles_discovered - a.roles_discovered || a.host.localeCompare(b.host),
  );
}

export interface TierAggregate extends TierBucket {
  tier: string;
}

export function aggregateByTier(rollups: DailyRollup[]): TierAggregate[] {
  const acc = new Map<string, TierAggregate>();
  for (const r of rollups) {
    for (const [tier, t] of Object.entries(r.by_tier)) {
      let a = acc.get(tier);
      if (!a) {
        a = {
          tier,
          runs: 0,
          duration_ms: 0,
          roles_discovered: 0,
          exa_calls: 0,
          exa_cost_usd: 0,
          last_exit_status: null,
        };
        acc.set(tier, a);
      }
      a.runs += t.runs;
      a.duration_ms += t.duration_ms;
      a.roles_discovered += t.roles_discovered;
      a.exa_calls += t.exa_calls;
      a.exa_cost_usd += t.exa_cost_usd;
      if (t.last_exit_status) a.last_exit_status = t.last_exit_status;
    }
  }
  for (const a of acc.values()) a.exa_cost_usd = round6(a.exa_cost_usd);
  return Array.from(acc.values()).sort((a, b) => b.runs - a.runs || a.tier.localeCompare(b.tier));
}

export interface DailySeries {
  date: string;
  claude_cost_usd: number;
  exa_cost_usd: number;
  total_cost_usd: number;
  roles_discovered: number;
  roles_enriched: number;
  roles_fit_6plus: number;
  cost_per_high_fit: number | null;
  applications_attributed: number;
  data_completeness: DataCompleteness;
}

export function aggregateByDate(rollups: DailyRollup[]): DailySeries[] {
  return rollups
    .map((r) => ({
      date: r.date,
      claude_cost_usd: r.totals.claude_cost_usd,
      exa_cost_usd: r.totals.exa_cost_usd,
      total_cost_usd: r.totals.total_cost_usd,
      roles_discovered: r.totals.roles_discovered,
      roles_enriched: r.totals.roles_enriched,
      roles_fit_6plus: r.totals.roles_fit_6plus,
      cost_per_high_fit:
        r.totals.roles_fit_6plus > 0
          ? round6(r.totals.total_cost_usd / r.totals.roles_fit_6plus)
          : null,
      applications_attributed: r.totals.applications_attributed || 0,
      data_completeness: r.data_completeness,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// -----------------------------------------------------------------------------
// Anomalies — collect across recent rollups, sort by severity, dedupe.
// -----------------------------------------------------------------------------

export interface SurfacedAnomaly extends Anomaly {
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
}

export function collectAnomalies(rollups: DailyRollup[]): SurfacedAnomaly[] {
  const acc = new Map<string, SurfacedAnomaly>();
  for (const r of rollups) {
    for (const a of r.anomalies || []) {
      const key = anomalyKey(a);
      const existing = acc.get(key);
      if (!existing) {
        acc.set(key, {
          ...a,
          first_seen: r.date,
          last_seen: r.date,
          occurrence_count: 1,
        });
      } else {
        existing.last_seen = r.date;
        existing.occurrence_count += 1;
        // Carry forward the most recent supplemental fields (counts may drift day to day).
        for (const k of Object.keys(a)) {
          if (k !== "type" && k !== "severity" && k !== "suggested_action") {
            (existing as Record<string, unknown>)[k] = a[k];
          }
        }
        // Upgrade severity if a newer occurrence is more severe.
        if (severityRank(a.severity) > severityRank(existing.severity)) {
          existing.severity = a.severity;
        }
      }
    }
  }
  return Array.from(acc.values()).sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.occurrence_count - a.occurrence_count,
  );
}

function anomalyKey(a: Anomaly): string {
  return `${a.type}::${a.source || ""}::${a.tier || ""}`;
}

function severityRank(s: string): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
