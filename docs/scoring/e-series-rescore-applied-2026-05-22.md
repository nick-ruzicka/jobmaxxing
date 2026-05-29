# E-series corpus re-score — APPLIED (2026-05-22)

**Trigger:** E4 (PR #24) revealed 72 records whose `score_adjusted` was stale relative to current scoring code — location-DQ wiring (PR #15) and comp-midpoint/trust-gate (PR #16) shipped without a full corpus re-score. Dry-run impact analysed in `e-series-restore-dryrun-2026-05-22.md`.

**This re-score applies rules already in `main` code; it introduces no new scoring logic.**

**Sequencing:** run *after* PR #24 merged (`f0d0225`) so `backfill-adjusted-scores.mjs` writes `score_clamp_reason` in the same pass.

**Command:** `node scripts/backfill-adjusted-scores.mjs` (live, no `--dry-run`), off post-#24 `main`.

## Why this is a docs-only PR

`data/enrichments.json` is gitignored — it's regenerated, not source-controlled. The data update happened on the local machine; this doc is the audit trail. Anyone on post-#24 `main` reproduces it by re-running the command above (same 72 records, same deltas).

## Verification (against a pre-run snapshot of all 1,239 records)

- **Exactly 72** records changed `score_adjusted`; the other **1,167 untouched**.
- New-zero breakdown (37): **10 disqualified** (carry `score_disqualification_reason`), **26 floor-clamped** (carry `score_clamp_reason`), **1 boundary-zero** (Rainbow — preclamp landed exactly 0, correctly carries neither).
- `clamp_reason` coverage 363 → **364** (net +1; the 26 new clamps offset by records that moved off 0 / became DQ).
- 61 down, 11 up. All 11 upward movers are NYC/remote roles gaining small amounts (max **+1.6**, Mastercard hybrid-NYC 3.6→5.2). **No NYC/remote role was disqualified** — location logic is not over-firing.

## 5 headline drops (corrected)

| company | role | old → new | mechanism | location |
|---|---|---|---|---|
| Gradial | GTM Engineer | 8.5 → 0 | **DQ** `fully on-site Seattle` | onsite Seattle |
| Cognition | Revenue Operations | 8.3 → 0 | **DQ** `fully on-site SF` | onsite San Francisco |
| Hiive | Director, Head of Revenue Operations | 8.5 → 0 | clamp `location:onsite_international (-75)` | onsite Vancouver |
| Sparta | RevOps & Enablement Lead | 9 → 1.2 | location penalty (not zeroed) | onsite London |
| Airwallex | Associate Director, Revenue Strategy | 5.5 → 0 | clamp `location:hybrid_sf (-40)` | hybrid San Francisco |

All five are onsite/hybrid in cities on the stated location deal-breaker list — they were stale top-prospects, now corrected.

## Cause attribution (from dry-run)

- location (#15): 52 · both (#15+#16): 7 · other: 13 → **59 / 72 location-driven.**

## Interaction with E4 (PR #24)

Of the 37 newly-zeroed roles, the 26 floor-clamped ones now carry `score_clamp_reason` (e.g. `location:onsite_international`) because PR #24 threaded that field through `backfill-adjusted-scores.mjs`. The 10 disqualified ones carry `score_disqualification_reason` instead (clamp_reason is null for DQ — by design). This is why #24 merged first.

## Not in scope

E6 (Web3 magnitude ratio) and E7 (scan-time vs dashboard override paths) untouched. This re-score is purely the propagation of #15/#16 to the persisted corpus.
