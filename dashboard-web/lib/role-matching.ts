// Canonical "open role for company X" predicate.
//
// ISSUE-002 (QA report 2026-05-17, polish-1 branch): the same company was
// reporting different role counts on /signals, /companies, /companies/[slug],
// and /pipeline because each surface had its own normalization + filter logic.
// Three views, three answers. This module collapses that into one predicate
// every surface calls.
//
// Design notes:
//
//  1. Score filtering is intentionally NOT in here. "Does this role exist for
//     this company" is a data question; "should I show roles below score 4"
//     is a view-layer preference. Coupling them means every UI default leaks
//     into the data layer, and Mistral-style cases (real role exists but all
//     scores are <4) get hidden by the wrong layer.
//
//  2. Slug fuzziness is in here. The pipeline scan writes `company: "Mistral"`
//     to seen-urls while the signal feed uses slug `mistralai` — same company,
//     two keys. The signals matcher already strips common suffixes (ai/labs/io/
//     etc.) to bridge them, but the company-detail aggregator does exact lookup
//     only, so the drilldown reports `roles: []` for Mistral. We share one
//     candidate-key generator so every surface sees the same set.
//
//  3. Aggregator listings (Sara's List, RevOps Careers, etc.) are excluded by
//     default — they re-syndicate roles already in the trusted ATS data and
//     create visual duplicates. The exception is "aggregator is the only
//     listing": better to show the user something than nothing.
//
// All callers should reach for `getOpenRolesForCompany(roles, slug)` — pass it
// the full `getRoles({includeAggregator:true})` array once and let the predicate
// do both the company match and the open-status filter.

import type { Role } from "./types";
import { companyKey } from "../../scripts/lib/normalize-company.mjs";

// Suffix tokens we strip when fuzzily matching company names. Kept in sync
// with scripts/lib/company-archetype-matcher.mjs's COMPANY_SUFFIXES so /signals
// and /companies/[slug] resolve the same company to the same role set.
const FUZZY_SUFFIXES = ["ai", "labs", "tech", "io", "hq", "app", "xyz"] as const;

// Role statuses we treat as "open" — i.e. roles still worth showing in a
// company's open-roles list. Applied/Interview/Offer all count: a role you've
// already applied to is still an "open role at that company" until the
// company closes it.
const OPEN_STATUSES = new Set<Role["status"]>([
  "Discovered",
  "Evaluated",
  "Applied",
  "Interview",
  "Offer",
]);

/**
 * All keys a slug-or-name could match. Used everywhere a company is identified
 * by slug. Strips known common suffixes so "mistralai" also matches "mistral".
 *
 * Returns at least one element (the canonical companyKey form). De-duped.
 *
 * Examples:
 *   companyCandidateKeys("Mistral AI")  → ["mistralai", "mistral"]
 *   companyCandidateKeys("mistralai")   → ["mistralai", "mistral"]
 *   companyCandidateKeys("EliseAI")     → ["eliseai", "elise"]
 *   companyCandidateKeys("Rillet")      → ["rillet"]
 */
export function companyCandidateKeys(slugOrName: string): string[] {
  const primary = companyKey(slugOrName) || slugOrName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!primary) return [];
  const out = [primary];
  for (const suffix of FUZZY_SUFFIXES) {
    if (primary.endsWith(suffix) && primary.length > suffix.length + 2) {
      const stripped = primary.slice(0, -suffix.length);
      if (!out.includes(stripped)) out.push(stripped);
    }
  }
  return out;
}

/** True when the role's status counts as "still open" (applyable). */
export function isOpenRoleStatus(role: Pick<Role, "status" | "stale" | "closed">): boolean {
  if (role.closed) return false;
  if (role.stale) return false;
  return OPEN_STATUSES.has(role.status);
}

/**
 * True when this role belongs to the given company slug.
 *
 * Fuzzy matching is symmetric: we generate candidates from BOTH sides (the
 * role's company name and the requested slug) and check for any overlap.
 * That's how seen-urls's "Mistral" and the signal's "mistralai" resolve to
 * the same company.
 */
export function roleBelongsToCompany(role: Pick<Role, "company">, slugOrName: string): boolean {
  const wanted = new Set(companyCandidateKeys(slugOrName));
  if (wanted.size === 0) return false;
  const got = companyCandidateKeys(role.company);
  return got.some((k) => wanted.has(k));
}

export interface CanonicalOpts {
  /**
   * When true, aggregator-source listings are kept. Defaults to false: if a
   * trusted-source listing exists for the company we hide the re-syndicators.
   * When the company has *only* aggregator listings we keep them (better than
   * showing zero); set this flag if you want the unfiltered set unconditionally.
   */
  includeAggregators?: boolean;
}

/**
 * The canonical "open roles for company X" list. Single source of truth for
 * every surface that displays a per-company role count.
 *
 * Filters applied (in order):
 *   1. role.company matches (fuzzy) slugOrName via companyCandidateKeys
 *   2. role is open (status ∈ OPEN_STATUSES, not stale, not closed)
 *   3. aggregator listings dropped unless they are the only matches
 */
export function getOpenRolesForCompany(
  allRoles: Role[],
  slugOrName: string,
  opts: CanonicalOpts = {}
): Role[] {
  const candidates = new Set(companyCandidateKeys(slugOrName));
  if (candidates.size === 0) return [];

  const forCompany = allRoles.filter((r) => roleBelongsToCompany(r, slugOrName));
  const open = forCompany.filter(isOpenRoleStatus);

  if (opts.includeAggregators) return open;

  const trusted = open.filter((r) => r.source_tier !== "aggregator");
  // Fallback: if removing aggregators leaves nothing, surface them — the user
  // wants to know the company is hiring *somewhere* even if it's via a
  // re-syndicator.
  return trusted.length > 0 ? trusted : open;
}

/** Convenience: count without materializing the array. */
export function countOpenRolesForCompany(
  allRoles: Role[],
  slugOrName: string,
  opts: CanonicalOpts = {}
): number {
  return getOpenRolesForCompany(allRoles, slugOrName, opts).length;
}
