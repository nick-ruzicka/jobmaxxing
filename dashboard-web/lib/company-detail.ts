// Typed wrapper around scripts/lib/company-aggregator.mjs for the dashboard.
//
// The .mjs aggregator is the source of truth; this module gives Next.js
// callers (the /api/companies/[slug] route and the future page server
// component) a stable, type-safe entry point.

import {
  aggregateCompany,
  aggregateAllCompanies,
} from "../../scripts/lib/company-aggregator.mjs";

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
 */
export function getCompanyDetail(
  slug: string,
  opts: AggregatorOpts = {}
): CompanyDetail | null {
  return aggregateCompany(slug, opts) as CompanyDetail | null;
}

/**
 * Get aggregates for every known company (roles ∪ signals).
 */
export function getAllCompanyDetails(
  opts: AggregatorOpts = {}
): Map<string, CompanyDetail> {
  return aggregateAllCompanies(opts) as Map<string, CompanyDetail>;
}
