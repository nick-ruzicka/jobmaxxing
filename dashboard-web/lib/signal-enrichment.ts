// Signal enrichment: archetype matching + hiring velocity for the /signals page.
//
// Wraps scripts/lib/company-archetype-matcher.mjs for dashboard consumption.
// Called server-side only (reads data files).

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ROOT, readJsonSafe } from "./data";
import type { Signal } from "./types";

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
  archetype_roles_count: number;
  total_roles: number;
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

  const results = new Map<string, SignalMatch>();
  for (const [slug, match] of rawResults) {
    results.set(slug, {
      ...match,
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
