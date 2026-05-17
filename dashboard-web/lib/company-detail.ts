// Typed wrapper around scripts/lib/company-aggregator.mjs for the dashboard.
//
// The .mjs aggregator is the source of truth; this module gives Next.js
// callers (the /api/companies/[slug] route and the future page server
// component) a stable, type-safe entry point.

import {
  aggregateCompany,
  aggregateAllCompanies,
} from "../../scripts/lib/company-aggregator.mjs";
import { generateThesis } from "../../scripts/lib/company-thesis.mjs";
import { getRoles } from "./data";
import { getOpenRolesForCompany } from "./role-matching";

// ---------------------------------------------------------------------------
// Types — mirror the shape produced by scripts/lib/company-aggregator.mjs.
// Kept narrow on purpose; loosen only as concrete consumers prove the need.
// ---------------------------------------------------------------------------

export type HiringVelocity = "cold" | "warming" | "hot" | "on_fire";

export interface CompanyIdentity {
  name: string;
  slug: string;
  funding_amount: string | null;
  funding_date: string | null;
  ats: string | null;
  employee_count: number | null;
}

export interface CompanyRole {
  id: string;
  title: string;
  archetype_primary: string | null;
  score_adjusted: number | null;
  score_base: number | null;
  link: string;
  firstSeen: string;
}

export interface FlagCount {
  flag: string;
  count: number;
}

export interface ThemeCount {
  theme: string;
  count: number;
}

export interface ValueCount<T> {
  value: T;
  count: number;
}

export interface StageMode {
  mode: string;
  count: number;
}

export interface EnrichmentSummary {
  green_flags: FlagCount[];
  red_flags: FlagCount[];
  team_context: ThemeCount[];
  company_stage: StageMode | null;
  build_component: ValueCount<boolean>[];
  ai_signal: ValueCount<boolean>[];
}

export interface CompanyDetail {
  identity: CompanyIdentity;
  roles: CompanyRole[];
  hiring_velocity: HiringVelocity;
  enrichment_summary: EnrichmentSummary;
  archetype_distribution: Record<string, number>;
  last_role_seen_date: string | null;
}

// Opts passthrough — mirrors the .mjs library's injection surface so vitest
// fixtures and the production path stay aligned.
export interface AggregatorOpts {
  seenUrls?: Record<string, unknown>;
  enrichments?: Record<string, unknown>;
  signals?: Array<Record<string, unknown>>;
  watchlist?: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a single company's aggregate, or null if the slug is unknown.
 * Slug is in `companyKey` form (lowercase alphanumeric) — same as /companies
 * and /signals use today.
 *
 * The `roles` field is filtered through the canonical isOpenRoleForCompany
 * predicate (lib/role-matching.ts) so the count agrees with /signals and the
 * /companies list. Without this, the aggregator's raw `roles` includes
 * aggregator-source duplicates (Sara's List etc.) and stale/closed roles,
 * which is why the QA report saw "26 Open Roles" while the list showed 13.
 *
 * Enrichment summary (green/red flags, team_context, stage) still derives
 * from the full URL set — those are *signals* about the company that don't
 * become wrong when aggregator listings are hidden.
 */
export function getCompanyDetail(
  slug: string,
  opts: AggregatorOpts = {}
): CompanyDetail | null {
  const raw = aggregateCompany(slug, opts) as CompanyDetail | null;
  if (!raw) return null;
  // Cross-reference with the dashboard's full Role dataset to apply the
  // canonical predicate (status filter + aggregator exclusion). When test
  // fixtures inject seenUrls/enrichments we don't have a getRoles() path,
  // so fall back to the aggregator's raw roles array unchanged.
  if (opts.seenUrls || opts.enrichments) return raw;
  const allRoles = getRoles({ includeAggregator: true });
  const canonical = getOpenRolesForCompany(allRoles, slug);
  // Project the dashboard's fat Role shape down to the narrower CompanyRole
  // shape the drilldown UI expects (id, title, archetype_primary, scores,
  // link, firstSeen). The aggregator's role objects are the source for
  // archetype_primary + scores — index them by URL and pick those out.
  const aggByLink = new Map<string, CompanyRole>(raw.roles.map((r) => [r.link, r]));
  const filtered: CompanyRole[] = canonical.map((r) => {
    const fromAgg = aggByLink.get(r.url);
    return {
      id: r.id,
      title: r.title,
      archetype_primary: fromAgg?.archetype_primary ?? null,
      score_adjusted: fromAgg?.score_adjusted ?? null,
      score_base: fromAgg?.score_base ?? null,
      link: r.url,
      firstSeen: r.firstSeen,
    };
  });
  return { ...raw, roles: filtered };
}

/**
 * Get aggregates for every known company (roles ∪ signals).
 */
export function getAllCompanyDetails(
  opts: AggregatorOpts = {}
): Map<string, CompanyDetail> {
  return aggregateAllCompanies(opts) as Map<string, CompanyDetail>;
}

// ---------------------------------------------------------------------------
// Thesis-aware detail (used by the /api/companies/[slug] route and the page)
// ---------------------------------------------------------------------------

export interface ThesisInfo {
  text: string | null;
  generated_at: string | null;
  cached: boolean;
  error?: string;
}

export interface CompanyDetailWithThesis extends CompanyDetail {
  thesis: ThesisInfo;
}

export interface ThesisOpts extends AggregatorOpts {
  /** Directory holding {slug}.json thesis caches. Defaults to data/company-theses/. */
  cacheDir?: string;
  /** When true, never call Claude — return cached or null. */
  readOnly?: boolean;
  /** When true, regenerate even if cache is fresh. */
  force?: boolean;
  /** Async (prompt) => string. Required only when readOnly=false and a Claude call may fire. */
  claudeCall?: (prompt: string) => Promise<string>;
}

/**
 * Default Claude caller used in production. Hits the Anthropic Messages API
 * with the project's standard headers. Throws if ANTHROPIC_API_KEY is missing
 * — the thesis library catches that and returns it as an error field, so the
 * page renders gracefully.
 */
export async function defaultClaudeCall(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      // Cheap model: thesis is ~50 words, no reasoning. Opus would be overkill.
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = json.content?.[0]?.text;
  if (!text) throw new Error("Anthropic response missing content text");
  return text;
}

/**
 * Get a company aggregate plus a (possibly cached, possibly null) thesis.
 *
 * - `readOnly: true`  → never calls Claude; returns whatever's on disk.
 * - `readOnly: false` → calls Claude on cache miss/stale (or `force: true`).
 *   Production callers should set this only behind an explicit user action.
 */
export async function getCompanyDetailWithThesis(
  slug: string,
  opts: ThesisOpts = {}
): Promise<CompanyDetailWithThesis | null> {
  const detail = getCompanyDetail(slug, opts);
  if (!detail) return null;
  const thesis = await generateThesis(detail, {
    cacheDir: opts.cacheDir,
    readOnly: opts.readOnly ?? true,
    force: opts.force ?? false,
    claudeCall: opts.claudeCall,
  });
  return {
    ...detail,
    thesis: {
      text: thesis.thesis,
      generated_at: thesis.generated_at,
      cached: thesis.cached,
      ...(thesis.error ? { error: thesis.error } : {}),
    },
  };
}
