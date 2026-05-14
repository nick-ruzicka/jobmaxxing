/**
 * source-detail.ts — per-host deep-dive data for /analytics/[source].
 *
 * Joins three sources:
 *  - data/seen-urls.json    -> all URLs we've ever discovered (per-URL metadata)
 *  - data/enrichments.json  -> per-URL enrichment outcomes + timestamps
 *  - data/analytics/daily/  -> rollup time series filtered to one host
 *
 * Pulls just enough to populate the deep-dive page; doesn't try to be a
 * full join over the pipeline state.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ROOT } from "./data";
import {
  loadRollups,
  type Range,
  type DailySeries,
  type SourceBucket,
} from "./analytics";

interface SeenEntry {
  firstSeen?: string;
  title?: string;
  source?: string;
  company?: string;
  location?: string;
  closed?: boolean;
}

interface EnrichmentEntry {
  fit_score?: number;
  comp_range?: string;
  error?: string;
  timestamp?: string;
  red_flags?: string[];
  green_flags?: string[];
  reason?: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function readJsonSafe<T>(p: string, fallback: T): T {
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export interface SourceDetailRole {
  url: string;
  title?: string;
  company?: string;
  firstSeen?: string;
  fit_score?: number;
  comp_range?: string;
  closed?: boolean;
}

export interface SourceDetailError {
  url: string;
  title?: string;
  error: string;
  timestamp?: string;
}

export interface UrlPatternBucket {
  pattern: string;
  count: number;
  example_url: string;
}

export interface SourceDetail {
  host: string;
  range: Range;
  found: boolean;
  totals: {
    urls_total: number;
    urls_in_range: number;
    /** Enrichments (success + error) whose timestamp falls in `range`. */
    enriched_total: number;
    /** Successful enrichments in `range`. */
    enriched_real: number;
    enrich_errors: number;
    fit_6plus: number;
    fit_7plus: number;
    has_comp: number;
    /** Real arithmetic mean of fit_score over `range`. `null` when no enrichments. */
    avg_fit: number | null;
    /** Fraction of `enriched_real` whose comp_range was a real number. */
    has_comp_coverage: number;
    open: number;
    closed: number;
  };
  daily: DailySeries[];
  per_source_daily: Array<{ date: string } & Partial<SourceBucket>>;
  recent_roles: SourceDetailRole[];
  recent_high_fit: SourceDetailRole[];
  recent_errors: SourceDetailError[];
  url_patterns: UrlPatternBucket[];
  suggested_actions: string[];
}

// Keep in lockstep with scripts/lib/analytics-rollup.mjs:hasRealComp.
const EMPTY_COMP_VALUES = new Set([
  "",
  "not listed",
  "none",
  "n/a",
  "na",
  "not specified",
  "not disclosed",
  "unknown",
]);
const QUALITATIVE_COMP_RE =
  /^(competitive|market|top of market|industry[- ]standard|commensurate|negotiable|doe\b|depends on experience)/i;
function hasRealComp(comp_range: string | undefined): boolean {
  if (typeof comp_range !== "string") return false;
  const c = comp_range.trim();
  if (!c) return false;
  if (EMPTY_COMP_VALUES.has(c.toLowerCase())) return false;
  if (QUALITATIVE_COMP_RE.test(c) && !/[$\d]/.test(c)) return false;
  return /[$\d]/.test(c);
}

function daysAgoFrom(today: Date, n: number): string {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function rangeStartDate(range: Range): string {
  const days = { "7d": 7, "30d": 30, "60d": 60, "90d": 90 }[range];
  return daysAgoFrom(new Date(), days - 1);
}

export function getSourceDetail(host: string, range: Range): SourceDetail {
  const seenUrls = readJsonSafe<Record<string, SeenEntry>>(
    join(ROOT, "data", "seen-urls.json"),
    {},
  );
  const enrichments = readJsonSafe<Record<string, EnrichmentEntry>>(
    join(ROOT, "data", "enrichments.json"),
    {},
  );

  const rangeStart = rangeStartDate(range);

  // -- Per-URL state for this host -------------------------------------------
  const matchHost = (h: string | null) => h === host || (h !== null && h.endsWith("." + host));
  const allUrls: Array<{ url: string; meta: SeenEntry }> = [];
  for (const [url, meta] of Object.entries(seenUrls)) {
    if (matchHost(hostOf(url))) allUrls.push({ url, meta });
  }

  // Range-filtered URL set — used for everything except the all-time totals.
  // Falls back to firstSeen on the seen-urls entry; if absent, we leave it out
  // of the range bucket (it can't be placed in time).
  const urlsInRange = allUrls.filter(
    (x) => (x.meta.firstSeen || "") >= rangeStart,
  );

  // Enrichments tied to in-range URLs (urls discovered in window OR enriched in window).
  // We use the enrichment's own timestamp when available; that's the more honest signal.
  const enriched: Array<{
    url: string;
    meta: SeenEntry;
    e: EnrichmentEntry;
  }> = [];
  for (const { url, meta } of allUrls) {
    const e = enrichments[url];
    if (!e) continue;
    const ts = (e.timestamp || "").slice(0, 10);
    if (ts && ts < rangeStart) continue; // out of window
    enriched.push({ url, meta, e });
  }

  const enrichedReal = enriched.filter((x) => !x.e.error);
  const enrichErrors = enriched.filter((x) => x.e.error);
  const fit6 = enrichedReal.filter((x) => (x.e.fit_score ?? 0) >= 6);
  const fit7 = enrichedReal.filter((x) => (x.e.fit_score ?? 0) >= 7);
  const hasCompList = enrichedReal.filter((x) => hasRealComp(x.e.comp_range));
  const closed = allUrls.filter((x) => x.meta.closed).length;

  const fitScores = enrichedReal
    .map((x) => x.e.fit_score)
    .filter((s): s is number => typeof s === "number");
  const avgFit =
    fitScores.length > 0
      ? Math.round((fitScores.reduce((a, b) => a + b, 0) / fitScores.length) * 10) / 10
      : null;
  const hasCompCoverage =
    enrichedReal.length > 0
      ? Math.round((hasCompList.length / enrichedReal.length) * 10000) / 10000
      : 0;

  // -- Daily series filtered to this host ------------------------------------
  const rollups = loadRollups(range);
  const daily: DailySeries[] = rollups
    .map((r) => {
      const s = r.by_source[host];
      return {
        date: r.date,
        claude_cost_usd: s?.claude_cost_usd ?? 0,
        exa_cost_usd: s?.exa_cost_usd ?? 0,
        total_cost_usd: (s?.claude_cost_usd ?? 0) + (s?.exa_cost_usd ?? 0),
        roles_discovered: s?.roles_discovered ?? 0,
        roles_enriched: s?.roles_enriched ?? 0,
        roles_fit_6plus: s?.roles_fit_6plus ?? 0,
        cost_per_high_fit:
          (s?.roles_fit_6plus ?? 0) > 0
            ? ((s!.claude_cost_usd + s!.exa_cost_usd) / s!.roles_fit_6plus!)
            : null,
        applications_attributed: s?.applications_attributed ?? 0,
        data_completeness: r.data_completeness,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const per_source_daily = rollups
    .map((r) => ({ date: r.date, ...(r.by_source[host] || {}) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // -- Recent role samples — RANGE-FILTERED so they match the page header ---
  const sortedByDate = [...urlsInRange].sort((a, b) =>
    (b.meta.firstSeen || "").localeCompare(a.meta.firstSeen || ""),
  );
  const recent_roles: SourceDetailRole[] = sortedByDate.slice(0, 25).map((x) => ({
    url: x.url,
    title: x.meta.title,
    company: x.meta.company,
    firstSeen: x.meta.firstSeen,
    fit_score: enrichments[x.url]?.fit_score,
    comp_range: enrichments[x.url]?.comp_range,
    closed: x.meta.closed,
  }));

  const recent_high_fit: SourceDetailRole[] = fit6
    .sort((a, b) => (b.meta.firstSeen || "").localeCompare(a.meta.firstSeen || ""))
    .slice(0, 15)
    .map((x) => ({
      url: x.url,
      title: x.meta.title,
      company: x.meta.company,
      firstSeen: x.meta.firstSeen,
      fit_score: x.e.fit_score,
      comp_range: x.e.comp_range,
    }));

  const recent_errors: SourceDetailError[] = enrichErrors
    .sort((a, b) => (b.e.timestamp || "").localeCompare(a.e.timestamp || ""))
    .slice(0, 15)
    .map((x) => ({
      url: x.url,
      title: x.meta.title,
      error: x.e.error || "unknown",
      timestamp: x.e.timestamp,
    }));

  // -- URL pattern analysis: replace numeric ids with {id}, slugs with {slug}.
  const url_patterns = analyzeUrlPatterns(allUrls.map((x) => x.url)).slice(0, 8);

  // -- Suggested actions based on the rollup signal --------------------------
  const suggested_actions = generateSuggestedActions({
    host,
    daily,
    fit6Count: fit6.length,
    enrichedReal: enrichedReal.length,
  });

  return {
    host,
    range,
    found: allUrls.length > 0,
    totals: {
      urls_total: allUrls.length,
      urls_in_range: urlsInRange.length,
      enriched_total: enriched.length,
      enriched_real: enrichedReal.length,
      enrich_errors: enrichErrors.length,
      fit_6plus: fit6.length,
      fit_7plus: fit7.length,
      has_comp: hasCompList.length,
      avg_fit: avgFit,
      has_comp_coverage: hasCompCoverage,
      open: allUrls.length - closed,
      closed,
    },
    daily,
    per_source_daily,
    recent_roles,
    recent_high_fit,
    recent_errors,
    url_patterns,
    suggested_actions,
  };
}

export function analyzeUrlPatterns(urls: string[]): UrlPatternBucket[] {
  const acc = new Map<string, { count: number; example: string }>();
  for (const url of urls) {
    try {
      const p = new URL(url).pathname;
      // Collapse numeric IDs (\d+ -> {id}) and slug-looking segments to {slug}.
      const normalized = p
        .split("/")
        .filter(Boolean)
        .map((seg) => {
          if (/^\d+$/.test(seg)) return "{id}";
          // UUID-like: 8+ hex chars with at least one hyphen, or all hex.
          if (/^[0-9a-f]{8,}$/i.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg)) return "{uuid}";
          // Slug: contains a hyphen, at least one letter, mostly alphanumerics.
          if (/[-_]/.test(seg) && /[a-z]/i.test(seg) && /^[a-z0-9-]+$/i.test(seg)) {
            return "{slug}";
          }
          return seg; // literal segment
        })
        .join("/");
      const pattern = "/" + normalized;
      const entry = acc.get(pattern);
      if (entry) entry.count += 1;
      else acc.set(pattern, { count: 1, example: url });
    } catch {
      // skip unparseable urls
    }
  }
  return Array.from(acc.entries())
    .map(([pattern, v]) => ({ pattern, count: v.count, example_url: v.example }))
    .sort((a, b) => b.count - a.count);
}

function generateSuggestedActions({
  host,
  daily,
  fit6Count,
  enrichedReal,
}: {
  host: string;
  daily: DailySeries[];
  fit6Count: number;
  enrichedReal: number;
}): string[] {
  const out: string[] = [];

  // 1. Hit rate degradation over the visible range
  if (daily.length >= 7) {
    const recent = daily.slice(-7);
    const earlier = daily.slice(-14, -7);
    const hitRate = (slice: DailySeries[]) => {
      const enr = slice.reduce((s, d) => s + d.roles_enriched, 0);
      const fit = slice.reduce((s, d) => s + d.roles_fit_6plus, 0);
      return enr > 0 ? fit / enr : 0;
    };
    const r = hitRate(recent);
    const e = hitRate(earlier);
    if (e > 0.15 && r < e * 0.7) {
      out.push(
        `Hit rate on ${host} dropped from ${(e * 100).toFixed(0)}% (prior 7d) to ${(r * 100).toFixed(0)}% (last 7d). Inspect the per-source extractor for regression.`,
      );
    }
  }

  // 2. Very low yield with non-trivial volume
  if (enrichedReal >= 20 && fit6Count / Math.max(enrichedReal, 1) < 0.05) {
    out.push(
      `Hit rate under 5% with ${enrichedReal} enrichments — consider quarantining or tightening the ICP filter for this source.`,
    );
  }

  // 3. Source silent in the last 3 days
  const last3 = daily.slice(-3);
  const last3Discoveries = last3.reduce((s, d) => s + d.roles_discovered, 0);
  const earlierAvg =
    daily.length >= 10
      ? daily.slice(-10, -3).reduce((s, d) => s + d.roles_discovered, 0) / 7
      : 0;
  if (last3Discoveries === 0 && earlierAvg >= 3) {
    out.push(
      `${host} produced 0 roles in the last 3 days but averaged ${earlierAvg.toFixed(1)}/day before. Crawler may have silently broken.`,
    );
  }

  return out;
}
