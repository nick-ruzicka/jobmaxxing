// Centralized company-name normalization.
//
// Two exports:
//   - normalizeCompany(name)  — returns the canonical *display* name (preserves
//     the casing of whatever the alias map decided, or of the input after
//     cleanup). Strips parentheticals, legal suffixes, trailing punctuation,
//     and applies the manual alias map.
//   - companyKey(name)        — returns the lowercased-alphanumeric form, used
//     for map/index keys. Calling companyKey(normalizeCompany(x)) and
//     companyKey(x) give the same answer — the alias-mapped form is stable
//     under reapplication.
//
// Used by scripts/scan-jobs.mjs (cross-company dedup), scripts/enrich-roles.mjs
// (per-company lookup), scripts/sync-score-feedback.mjs (reconciliation),
// and re-exported through dashboard-web/lib/data.ts so the dashboard sees
// identical groupings.
//
// Pure module, no side effects.

// ---------------------------------------------------------------------------
// Manual alias map
// ---------------------------------------------------------------------------
// Keys are the lowercased-alphanumeric form of the (already-cleaned-of-parens-
// and-legal-suffixes) input. Values are the canonical display name.
//
// Order doesn't matter — this is a flat lookup.
const ALIASES = {
  // Companies that spell their name oddly
  norminalso: "Nominal",
  hebbiaai: "Hebbia",

  // Common legal-form leftovers when the suffix list misses one
  openai: "OpenAI",         // makes "OpenAI Inc" idempotent (Inc stripped first)
  openaiinc: "OpenAI",      // defensive: in case the suffix-strip somehow fails

  // xAI — the company variously spelled X, X.AI, xAI, "X (formerly Twitter)".
  // After parens-strip, "X (formerly Twitter)" → "X", which then aliases.
  x: "xAI",
  xai: "xAI",
};

// ---------------------------------------------------------------------------
// Cleanup primitives
// ---------------------------------------------------------------------------

// Legal-suffix tokens to strip from the *end* of the name. Order: more
// specific patterns first so e.g. ", Inc." beats " Inc".
const LEGAL_SUFFIX_RE = /(?:,?\s*(?:Inc\.?|LLC|Ltd\.?|GmbH|Corp\.?|Corporation|Co\.?|S\.A\.|S\.L\.|AG|N\.V\.|B\.V\.|PLC|S\.r\.l\.|S\.r\.l|S\.p\.A\.))+\s*$/i;

// Strip ALL parenthesized segments (parens or brackets). Examples:
//   "Norminal.So (Nominal)"         → "Norminal.So"
//   "X (formerly Twitter)"          → "X"
//   "Foo [Stealth]"                 → "Foo"
const PARENTHETICAL_RE = /\s*[([{][^)\]}]*[)\]}]\s*/g;

// Trailing punctuation we always strip (after suffix/parens removal).
const TRAILING_PUNCT_RE = /[.!?,\s]+$/;

/**
 * Normalize a company name to its canonical display form.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeCompany(name) {
  if (!name || typeof name !== "string") return "";
  let out = name;

  // 1. Strip all parenthesized segments
  out = out.replace(PARENTHETICAL_RE, " ");

  // 2. Strip legal suffixes (repeat in case of stacked, e.g. "Acme, Inc., LLC")
  for (let i = 0; i < 3; i++) {
    const next = out.replace(LEGAL_SUFFIX_RE, "");
    if (next === out) break;
    out = next;
  }

  // 3. Strip trailing punctuation and whitespace
  out = out.replace(TRAILING_PUNCT_RE, "");

  // 4. Collapse internal whitespace and trim
  out = out.replace(/\s+/g, " ").trim();

  if (!out) return "";

  // 5. Alias map lookup
  const key = out.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (ALIASES[key]) return ALIASES[key];

  return out;
}

/**
 * Lowercased-alphanumeric key for a company name. Stable under double-
 * application: companyKey(normalizeCompany(x)) === companyKey(x).
 *
 * @param {string} name
 * @returns {string}
 */
export function companyKey(name) {
  const normalized = normalizeCompany(name);
  return normalized.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// The alias map is exported for tests / debugging only. Do NOT import it as
// the source of truth — `normalizeCompany` handles the cleanup pipeline
// around it.
export { ALIASES as _ALIASES };
