// backfill-locations-skip.mjs — predicate used by backfill-locations.mjs to decide
// whether an entry's structured-location upgrade has already happened.
//
// History: the original check was `typeof entry.location_workplace === "string"`,
// which treated "unknown" (a string) as "already structured." That permanently
// skipped Tier-8-discovered ATS URLs whose first scrape failed location extraction
// (e.g. Gumloop SF role landing with workplace="unknown" and staying there forever
// despite repeated backfill runs).
//
// New rule: skip only when a NON-"unknown" workplace value has been recorded.
// Anything missing, null, undefined, empty, or literal "unknown" is fair game for
// re-evaluation.

export function shouldSkipBackfill(entry) {
  if (!entry || typeof entry.location_workplace !== "string") return false;
  if (entry.location_workplace === "" || entry.location_workplace === "unknown") return false;
  return true;
}
