// Single source of truth for company-name fuzzy-matching constants, shared by
// the Node scripts (company-aggregator, company-archetype-matcher) and the
// TypeScript dashboard (role-matching.ts imports this .mjs directly).
//
// Before this module these lists were copy-pasted in 3 places (FUZZY_SUFFIXES /
// COMPANY_SUFFIXES) and 2 places (PRIMARY_ARCHETYPES, as Set + array). The pin
// test at dashboard-web/lib/canonical-counts-integration.test.ts guards the
// fuzzy-match behavior; this module removes the drift root cause.

// Suffix tokens stripped when fuzzily matching company names (lowercased, no
// separators). "mistralai" → also matches "mistral".
export const FUZZY_SUFFIXES = ["ai", "labs", "tech", "io", "hq", "app", "xyz"];

// Archetypes the user actively targets (used for "in scope" predicates).
export const PRIMARY_ARCHETYPES = ["gtm-engineering", "ai-operations", "fde"];

// Set form for O(1) membership tests (company-aggregator uses this shape).
export const PRIMARY_ARCHETYPES_SET = new Set(PRIMARY_ARCHETYPES);
