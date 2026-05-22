// Single source of truth for the "is this comp string real?" predicate, shared
// by analytics-rollup.mjs (Node) and source-health.ts + source-detail.ts (TS).
// All three previously held byte-identical copies; this removes the drift risk.
//
// "Real comp" = a string carrying a numeric range or amount. "Not listed",
// "Competitive", and qualitative-only entries don't count.

export const EMPTY_COMP_VALUES = new Set([
  "",
  "not listed",
  "none",
  "n/a",
  "na",
  "not specified",
  "not disclosed",
  "unknown",
]);

export const QUALITATIVE_COMP_RE =
  /^(competitive|market|top of market|industry[- ]standard|commensurate|negotiable|doe\b|depends on experience)/i;

export function hasRealComp(comp_range) {
  if (typeof comp_range !== "string") return false;
  const c = comp_range.trim();
  if (!c) return false;
  if (EMPTY_COMP_VALUES.has(c.toLowerCase())) return false;
  if (QUALITATIVE_COMP_RE.test(c) && !/[$\d]/.test(c)) return false;
  return /[$\d]/.test(c);
}
