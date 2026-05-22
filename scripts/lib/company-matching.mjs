// Single source of truth for company-name fuzzy-matching constants + the
// candidate-key generator, shared by the Node scripts (company-aggregator,
// company-archetype-matcher) and the TypeScript dashboard (role-matching.ts
// re-exports companyCandidateKeys and imports the constants).
//
// Before this module these lists were copy-pasted in 3 places (FUZZY_SUFFIXES /
// COMPANY_SUFFIXES) and 2 places (PRIMARY_ARCHETYPES, as Set + array), and the
// candidate-key function existed in 3 divergent copies. The pin test at
// dashboard-web/lib/canonical-counts-integration.test.ts guards the fuzzy-match
// behavior; this module removes the drift root cause.

import { companyKey } from "./normalize-company.mjs";

// Suffix tokens stripped when fuzzily matching company names (lowercased, no
// separators). "mistralai" → also matches "mistral".
export const FUZZY_SUFFIXES = ["ai", "labs", "tech", "io", "hq", "app", "xyz"];

// Archetypes the user actively targets (used for "in scope" predicates).
export const PRIMARY_ARCHETYPES = ["gtm-engineering", "ai-operations", "fde"];

// Set form for O(1) membership tests (company-aggregator uses this shape).
export const PRIMARY_ARCHETYPES_SET = new Set(PRIMARY_ARCHETYPES);

/**
 * All keys a slug-or-name could match. Strips known suffixes so "mistralai"
 * also matches "mistral". Returns the canonical companyKey form first, deduped.
 * Single source for the Node scripts (company-aggregator, company-archetype-
 * matcher) and the dashboard (role-matching.ts re-exports this).
 *
 * @param {string} slugOrName - raw slug or display name (normalized internally)
 * @returns {string[]} candidate keys, canonical form first, deduped
 */
export function companyCandidateKeys(slugOrName) {
  const primary = companyKey(slugOrName) || String(slugOrName).toLowerCase().replace(/[^a-z0-9]/g, "");
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
