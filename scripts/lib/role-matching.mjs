// Single source of truth for ROLE-TITLE fuzzy matching, used by
// `merge-tracker.mjs` to dedup tracker rows when an incoming row's
// company normalizes to the same value as an existing row's company.
//
// Why this lives here and not in merge-tracker.mjs:
//   The bug-verification audit (docs/audits/2026-05-22-upstream-bug-
//   verification.md, CHECK 3) confirmed that the previous inline
//   implementation in merge-tracker.mjs collapsed IC↔manager and
//   PM↔PD↔PE within the same company. The fix needs test coverage,
//   so it moves into scripts/lib/ alongside company-matching.mjs
//   (its sibling for company-name fuzzing).
//
// The previous implementation:
//
//   function roleFuzzyMatch(a, b) {
//     const wordsA = a.toLowerCase().split(/\s+/).filter(w => w.length > 3);
//     const wordsB = b.toLowerCase().split(/\s+/).filter(w => w.length > 3);
//     const overlap = wordsA.filter(w =>
//       wordsB.some(wb => wb.includes(w) || w.includes(wb)));
//     return overlap.length >= 2;
//   }
//
// Failure modes it had (each verified in role-matching.test.mjs):
//   - "Senior Software Engineer" ≡ "Senior Software Architect"
//     (false-match on baseline-only overlap: senior + software)
//   - "Staff Engineer" ≡ "Staff Engineering Manager"
//     (IC vs manager false-match via engineer⊂engineering)
//   - "Senior Product Manager" ≡ "Senior Product Designer"
//     (PM vs PD false-match on senior + product)
//
// This module enforces two extra invariants:
//   1. Asymmetric management-track guard: if one title has a management
//      token (manager, director, head, vp, chief) and the other doesn't,
//      they're different career tracks, period.
//   2. At least one EXACT (not substring) overlap on a non-baseline
//      specialty token. Baseline tokens (seniority, generic role types,
//      common domain modifiers) cannot, by themselves, satisfy the match.
//
// Plus an exact-string short-circuit so trivially identical titles
// always dedup.

/**
 * Baseline tokens that DON'T count as a specialty match on their own.
 * Three buckets: seniority, generic role types, common domain modifiers.
 * If two titles overlap only on baseline tokens, they're not the same role.
 */
export const BASELINE_TOKENS = new Set([
  // seniority
  "senior", "staff", "principal", "lead", "junior", "associate", "entry", "mid",
  // generic role types (engineer is here because it's the most common
  // English title suffix and matches across totally different specialties)
  "engineer", "engineering", "manager", "director", "head", "vp",
  "designer", "design", "architect", "analyst", "consultant", "specialist",
  "scientist",
  // common domain modifiers (alone they distinguish nothing)
  "software", "product", "platform", "systems", "technical", "technology",
]);

/**
 * Management-track tokens. The presence/absence of any of these tokens
 * in one title but not the other implies different career tracks
 * (e.g. IC vs manager). Used for the asymmetric track guard.
 */
export const MGMT_TOKENS = new Set([
  "manager", "director", "head", "vp", "chief",
]);

/**
 * Lowercase, strip non-alphanumeric, split on whitespace, drop empties.
 * "Senior Software Engineer, AI" → ["senior", "software", "engineer", "ai"]
 *
 * @param {string} s
 * @returns {string[]}
 */
export function tokenize(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Fuzzy-match two role titles. Returns true iff they should be treated
 * as the same role for tracker-dedup purposes (within the same company —
 * the caller is responsible for the company-key match).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function roleFuzzyMatch(a, b) {
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);

  if (wordsA.length === 0 || wordsB.length === 0) return false;

  // Exact tokenized match → trivially the same role.
  if (
    wordsA.length === wordsB.length &&
    wordsA.every((w, i) => w === wordsB[i])
  ) {
    return true;
  }

  // Asymmetric management-track guard. One has a mgmt token, the other
  // doesn't → different career tracks. (Both with or both without → fall
  // through to the specialty check.)
  const aMgmt = wordsA.some((w) => MGMT_TOKENS.has(w));
  const bMgmt = wordsB.some((w) => MGMT_TOKENS.has(w));
  if (aMgmt !== bMgmt) return false;

  // Require at least one EXACT (not substring) overlap on a non-baseline
  // specialty token. length ≥ 2 preserves short specialty acronyms
  // (ML, QA, AI, BI, UX, GTM) that the previous length > 3 filter dropped.
  const specialtyA = wordsA.filter(
    (w) => w.length >= 2 && !BASELINE_TOKENS.has(w),
  );
  const specialtyOverlap = specialtyA.filter((w) => wordsB.includes(w));
  if (specialtyOverlap.length === 0) return false;

  // Plus the original ≥ 2 token substring-overlap requirement — preserves
  // back-compat for legitimate variants like "Senior Backend Engineer"
  // dedup'ing against "Backend Engineer". Now operates on length ≥ 2
  // tokens so short acronyms also count.
  const longA = wordsA.filter((w) => w.length >= 2);
  const longB = wordsB.filter((w) => w.length >= 2);
  const overlap = longA.filter((w) =>
    longB.some((wb) => wb.includes(w) || w.includes(wb)),
  );
  return overlap.length >= 2;
}
