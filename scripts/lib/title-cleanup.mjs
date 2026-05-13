// Title cleanup — strip source-attribution suffixes that pollute job titles
// scraped from aggregators (Built In, LinkedIn, Wellfound, etc.) and from
// generic " at <Company>" duplication when the company field already carries
// the same value.
//
// Pure function. Idempotent: cleanTitle(cleanTitle(x)) === cleanTitle(x).
// Safe on null/undefined/empty input (returns "").
//
// Wired into scripts/scan-jobs.mjs so that titles get normalized *before*
// the cross-company dedup keying, which means two URLs whose titles differ
// only by a "| Built In NYC" suffix collapse to the same role naturally.

const JOB_BOARDS = [
  "Built In",      // covers "Built In <city>" and the bare " | Built In"
  "LinkedIn",
  "Wellfound",
  "AngelList",
  "Indeed",
  "Glassdoor",
  "ZipRecruiter",
  "Otta",
  "Welcome to the Jungle",
  "Hacker News",
  "Y Combinator",
  "Workable",
  "Lever",
  "Greenhouse",
  "Ashby",
];

// Match the LAST " | <suffix>" segment where the suffix starts with a known
// job-board name. We pin to the end of the string so we only strip trailing
// attribution, not e.g. a job-board name appearing mid-title.
const JOB_BOARD_SUFFIX_RE = new RegExp(
  `\\s*[|·•]\\s*(?:${JOB_BOARDS.map(escapeRegex).join("|")})(?:\\s+[^|·•]*)?\\s*$`,
  "i",
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Light-touch normalization shared between cleaning + comparison.
function tidy(s) {
  return (s || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[—–-]\s*$/, "") // trailing dashes left behind after stripping
    .replace(/\s*\|\s*$/, "")    // trailing pipe left behind after stripping
    .trim();
}

/**
 * Strip source-attribution suffixes from a scraped title.
 *
 * @param {string} title - The raw title to clean.
 * @param {object} [opts]
 * @param {string} [opts.company] - The role's resolved company. When provided,
 *   a trailing " at <Company>" suffix is removed (matched case-insensitively).
 * @returns {string} The cleaned title (or "" if input was falsy).
 */
export function cleanTitle(title, opts = {}) {
  if (!title || typeof title !== "string") return "";
  let out = title;

  // Apply job-board suffix stripping repeatedly — handles edge cases like
  // "Foo | Built In NYC | LinkedIn" by peeling one suffix at a time.
  for (let i = 0; i < 4; i++) {
    const next = out.replace(JOB_BOARD_SUFFIX_RE, "");
    if (next === out) break;
    out = next;
  }

  // " at <Company>" suffix — strip only when the company is provided and the
  // suffix exactly matches it (case-insensitive). Avoids accidentally
  // stripping " at Series A startup" when company is actually "Acme".
  if (opts.company && typeof opts.company === "string") {
    const co = opts.company.trim();
    if (co) {
      const escaped = escapeRegex(co);
      const atSuffixRe = new RegExp(`\\s+at\\s+${escaped}\\s*$`, "i");
      out = out.replace(atSuffixRe, "");
    }
  }

  return tidy(out);
}

/**
 * Score a title for "cleanliness" — lower is cleaner. Used to pick the
 * preferred display title when two candidates collide on (company, role).
 *
 * Penalties:
 *   - Length (longer is dirtier)
 *   - Presence of an un-stripped job-board attribution
 *   - Presence of a stray pipe / bullet separator
 */
export function titleCleanScore(title) {
  if (!title) return Number.POSITIVE_INFINITY;
  let score = title.length;
  if (JOB_BOARD_SUFFIX_RE.test(title)) score += 100;
  if (/[|·•]/.test(title)) score += 25;
  return score;
}

/**
 * Pick the cleaner of two candidate titles for the same (company, role).
 * Tie-breaker: prefer `a` (the existing entry) — matches the scanner's
 * "first-seen wins" semantics so a same-cleanliness re-scrape doesn't
 * cause churn.
 */
export function preferCleanerTitle(a, b, _opts = {}) {
  // Score the raw inputs — both candidates may *clean* to the same string,
  // but we want to return whichever input is already closer to clean (so the
  // caller can store the tidier form without further mutation).
  const sa = titleCleanScore(a);
  const sb = titleCleanScore(b);
  return sb < sa ? b : a;
}
