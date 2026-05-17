// Signal enrichment: archetype matching + hiring velocity for the /signals page.
//
// Wraps scripts/lib/company-archetype-matcher.mjs for dashboard consumption.
// Called server-side only (reads data files).

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ROOT, readJsonSafe, getRoles } from "./data";
import type { Signal } from "./types";
import { countOpenRolesForCompany } from "./role-matching";

// Import the matcher (ESM → works in Next.js server components)
import {
  matchSignalCompanies,
  passesArchetypeFilter,
  matchStatus as getMatchStatus,
  classifyVelocity,
} from "../../scripts/lib/company-archetype-matcher.mjs";

export type MatchStatus = "confirmed_match" | "confirmed_no_match" | "unknown";
export type HiringVelocity = "cold" | "warming" | "hot" | "on_fire";

export interface SignalMatch {
  archetypes_matched: string[];
  /**
   * Archetype-matched role count from the legacy matcher. Kept for internal
   * use (velocity classification, the expanded detail panel breakdown). UI
   * should prefer `open_roles_count` for the headline "N matching roles"
   * display — it's the canonical predicate from lib/role-matching.ts and
   * matches what /companies/[slug] and /pipeline?company=X show.
   */
  archetype_roles_count: number;
  total_roles: number;
  /**
   * Canonical open-roles count (lib/role-matching.ts). Used for the
   * "N matching roles" label so /signals, /companies, and /pipeline agree.
   * Zero means the signal is stale relative to the current pipeline data
   * (signal fired some time ago, no live open roles right now).
   */
  open_roles_count: number;
  hiring_velocity: HiringVelocity;
  has_pipeline_roles: boolean;
  match_status: MatchStatus;
}

export interface EnrichedSignal extends Signal {
  match: SignalMatch;
}

/**
 * Enrich signals with archetype matching and hiring velocity.
 * Returns a Map<slug, SignalMatch> for the signals page to consume.
 */
export function getSignalMatches(signals: Signal[]): Map<string, SignalMatch> {
  const seenUrls = readJsonSafe<Record<string, { company?: string }>>(
    join(ROOT, "data", "seen-urls.json"),
    {}
  );
  const enrichments = readJsonSafe<Record<string, { archetype_primary?: string }>>(
    join(ROOT, "data", "enrichments.json"),
    {}
  );

  const signalInput = signals.map((s) => ({ slug: s.slug, name: s.name }));
  const rawResults = matchSignalCompanies(signalInput, seenUrls, enrichments);

  // Canonical open-role count — single source of truth shared with /companies
  // and /pipeline. ISSUE-002: before this, /signals reported "1 matching role"
  // for Mistral while /companies/mistralai reported 0 and the pipeline filter
  // returned 0/1262 — three different answers for the same company.
  const allRoles = getRoles({ includeAggregator: true });

  const results = new Map<string, SignalMatch>();
  for (const [slug, match] of rawResults) {
    results.set(slug, {
      ...match,
      open_roles_count: countOpenRolesForCompany(allRoles, slug),
      match_status: getMatchStatus(match),
    });
  }
  return results;
}

/**
 * Load excluded companies from user-context.yaml.
 * Returns a Set of company slugs that the user has permanently dismissed.
 */
export function getExcludedCompanies(): Set<string> {
  const contextPath = join(ROOT, "config", "user-context.yaml");
  if (!existsSync(contextPath)) return new Set();

  const content = readFileSync(contextPath, "utf-8");
  // Simple YAML parsing for excluded_companies array
  const match = content.match(/excluded_companies:\s*\n((?:\s+-\s+.+\n?)*)/);
  if (!match) return new Set();

  const slugs = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

  return new Set(slugs);
}
