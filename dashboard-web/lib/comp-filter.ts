// Comp-floor filter predicates for the pipeline table. Reuses compMidpoint from
// the scoring layer's parser (scripts/lib/comp-parse.mjs) so the filter's notion
// of "above $X" matches Fix D: a range is judged by its midpoint, not its min.
import { compMidpoint } from "../../scripts/lib/comp-parse.mjs";

// A role passes the comp floor when there's no floor, or its comp doesn't parse
// (unknown comp stays VISIBLE — surfaced on sufferance, not hidden), or its
// midpoint meets the floor.
export function passesCompFloor(comp: string, minComp: number): boolean {
  if (minComp <= 0) return true;
  const mid = compMidpoint(comp);
  if (mid === null) return true;
  return mid >= minComp;
}

// True when a floor is active but this role's comp doesn't parse — i.e. it's
// shown only because unknowns aren't hidden. Drives the row's "comp unknown" mark.
export function isUnknownUnderFloor(comp: string, minComp: number): boolean {
  return minComp > 0 && compMidpoint(comp) === null;
}
