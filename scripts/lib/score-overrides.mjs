// Single source for manual eval-override application (data/score-overrides.json).
//
// Before this module the override math lived in two divergent copies:
//   - scripts/scan-jobs.mjs autoScore() — coarse: block→1, penalize→min(base,4), boost→base+2
//     (and it applied penalize + boost SEQUENTIALLY, so a company in both got both)
//   - dashboard-web/lib/data.ts getRoles() — precise: eval×2 when the override carries a
//     /5 score, with strict block>boost>penalize precedence
// They could score the same company differently by surface. This module is the
// dashboard's precise behavior, now shared by both. (E7-C.)
//
// NOTE: sync-score-feedback.mjs is the PRODUCER of score-overrides.json (eval→bucket
// assignment); it is not a consumer of this apply-math and intentionally does not import this.

const clampScore = (n) => Math.max(1, Math.min(10, Math.round(n)));

/**
 * Resolve which override bucket a company key falls into, with precedence
 * block > boost > penalize. Returns null when no override applies.
 *
 * @param {{block?: string[], boost?: Record<string,{score?:number|null,reason?:string}>, penalize?: Record<string,{score?:number|null,reason?:string}>}} overrides
 * @param {string} ck - companyKey (lowercase alphanumeric)
 * @returns {{bucket: "block"|"boost"|"penalize", score: number|null, reason: string}|null}
 */
export function resolveOverride(overrides, ck) {
  if (!ck || !overrides) return null;
  if ((overrides.block || []).includes(ck)) {
    return { bucket: "block", score: null, reason: "Blocked — eval ≤ 1.5/5" };
  }
  const boost = overrides.boost?.[ck];
  if (boost) {
    return { bucket: "boost", score: typeof boost.score === "number" ? boost.score : null, reason: boost.reason };
  }
  const pen = overrides.penalize?.[ck];
  if (pen) {
    return { bucket: "penalize", score: typeof pen.score === "number" ? pen.score : null, reason: pen.reason };
  }
  return null;
}

/**
 * Apply a resolved override to a base score. Mirrors the dashboard's precise math:
 *   block                    -> 1
 *   boost,   eval score set  -> clamp(round(score * 2))   // eval ×2 replaces base
 *   boost,   no score        -> clamp(base + 2)
 *   penalize,eval score set  -> clamp(round(score * 2))
 *   penalize,no score        -> min(base, 4)               // base-relative (unclamped, matches dashboard)
 *   no override (null)       -> base unchanged
 *
 * @param {number} baseScore
 * @param {{bucket:string, score:number|null}|null} resolved
 * @returns {number}
 */
export function applyScoreOverrides(baseScore, resolved) {
  if (!resolved) return baseScore;
  switch (resolved.bucket) {
    case "block":
      return 1;
    case "boost":
      return typeof resolved.score === "number" ? clampScore(resolved.score * 2) : clampScore(baseScore + 2);
    case "penalize":
      return typeof resolved.score === "number" ? clampScore(resolved.score * 2) : Math.min(baseScore, 4);
    default:
      return baseScore;
  }
}
