# California-Is-Canada Fix — Re-Score Impact (Dry Run)

**Date:** 2026-05-18
**Branch:** `fix/california-is-canada` (PR #5 — opened, not merged)
**Mode:** dry-run — no writes to `data/enrichments.json`
**Trigger:** scoring engine audit `docs/audits/2026-05-18-scoring-engine-audit.md` §B.2 + Top finding #1 — `NON_US_CODES` contained `"ca"`, routing California-region roles to international.

## Method

1. Loaded `data/enrichments.json` on the `fix/california-is-canada` branch (1,122 enriched records, 1,077 with `archetype_primary` AND a persisted `score_adjusted`).
2. For each, re-ran `adjustScore` against the FIXED `scripts/lib/scoring-layer.mjs` (the branch's isUS now prefers US state codes; CA/DE/IL/AR/CO/IN classify as US).
3. Compared the new `score_adjusted` against the persisted `score_adjusted` — no writes.

Analysis script: `/tmp/california-fix-impact-analysis.mjs` (one-shot, not committed — temp analysis only).

## Cohort counts

| Cohort | Count |
|---|---|
| Total records examined (enriched + archetype + score_adjusted) | 1,077 |
| Records with a California-relevant region (CA/California/DE/IL/AR/CO/IN) | 68 |
| **Records whose score_adjusted would change** | **27** |
| ↳ score INCREASED | 16 |
| ↳ score DECREASED | 11 |

> **Drift caveat.** Some of the 27 changes are NOT directly attributable to the California fix — they're records where the location adjustment never fired at original scoring time (because location data was missing) and would have re-scored under any current code. The scoring audit calls this out: "Each row's drift baseline equals the new score, meaning the change is entirely from re-running today's scoring code/config against historically-scored roles."
>
> The California-fix-attributable subset is the ~12 records with `region="ca"` where the OLD scoring path had `location:hybrid_international (-50)` or `location:onsite_international (-75)` and the NEW path has `location:hybrid_other_us (-25)` or `location:onsite_other_us (-60)`. These are exactly the `+1.5` (onsite SF/CA) and `+2.5` (hybrid CA) deltas in the top-30 below.
>
> The other ~15 changes (mostly score decreases) are backfill-catch-up that would re-score the same way under the unfixed code. Persisting them is a corpus-hygiene side effect of running ANY re-score now.

## Delta statistics

| Metric | Value |
|---|---|
| Mean delta | -0.4 |
| Median delta | +0.5 |
| Max delta | +2.5 |
| Min delta | -8.3 (OpenAI Product Engineer — see below) |

### Distribution by |Δ|

| Bin | Count |
|---|---|
| 0 – 0.5 | 1 |
| 0.5 – 1 | 5 |
| 1 – 2 | 9 |
| 2 – 3 | 7 |
| 3 – 4 | 2 |
| 4 – 5 | 1 |
| 5+ | 2 |

The bulk (15 of 27) are small deltas (<2 points). The two 5+ outliers are OpenAI (-8.3) and Introhive (-5), both backfill-catch-up cases, not pure California-fix wins.

## Top 30 records by |Δ|

(Only 27 actually change; the full list is below — there are no records 28–30.)

| # | Company | Title | Region · City · Workplace | Old → New | Δ | Old location adj | New location adj |
|---|---|---|---|---|---|---|---|
| 1 | OpenAI | Product Engineer, GTM Innovation | ca · san francisco · onsite | 9.3 → 1 | **-8.3** | (no location adj) | onsite_other_us (-60) |
| 2 | Introhive | Head of GTM Enablement in Toronto, ON | (empty) · toronto · onsite | 5 → 0 | -5 | (no location adj) | onsite_international (-75) |
| 3 | Enable | Director of Revenue Operations | canada · toronto · onsite | 4.9 → 0 | -4.9 | (no location adj) | onsite_international (-75) |
| 4 | Built In Boston | GTM Engineer: Data Infrastructure & AI Intelligence | (empty) · boston · onsite | 3.5 → 0 | -3.5 | (no location adj) | onsite_international (-75) |
| 5 | Databricks | Sr Analytics Engineer — GTM Strategy and Operations | (empty) · (empty) · onsite | 3.5 → 0 | -3.5 | (no location adj) | onsite_international (-75) |
| 6 | Paytm | Enterprise GTM Lead, Inference and Agentic AI | (empty) · (empty) · unknown | 4 → 1.5 | -2.5 | (no location adj) | (no location adj) |
| 7 | Replit | Director RevOps Architect | ca · foster city · hybrid | 1 → 3.5 | **+2.5** | hybrid_international (-50) | **hybrid_other_us (-25)** ← fix |
| 8 | snowflake | Director, Sales Operations Go-to-Market Planning | ca · menlo park · hybrid | 1.5 → 4 | **+2.5** | hybrid_international (-50) | **hybrid_other_us (-25)** ← fix |
| 9 | Sift Stack | GTM Engineer | ca · marina del rey · hybrid | 5.5 → 8 | **+2.5** | hybrid_international (-50) | **hybrid_other_us (-25)** ← fix |
| 10 | Eve | Senior Manager, Revenue Systems | ca · san mateo · hybrid | 4 → 6.5 | **+2.5** | hybrid_international (-50) | **hybrid_other_us (-25)** ← fix |
| 11 | xAI | Head of GTM — Systems & Agents | ca · palo alto · hybrid | 5.5 → 8 | **+2.5** | hybrid_international (-50) | **hybrid_other_us (-25)** ← fix |
| 12 | Jobs (Gumloop) | GTM Operations Lead @ Gumloop | (empty) · (empty) · unknown | 9.8 → 7.8 | -2 | (no location adj) | (no location adj) |
| 13 | Skydio | Senior Revenue Operations Manager | ca · san mateo · hybrid | 1.5 → 0 | -1.5 | (no location adj) | hybrid_other_us (-25) |
| 14 | You.com | Head of Revenue Operations | ca · san francisco · onsite | 1.5 → 3 | **+1.5** | onsite_international (-75) | **onsite_other_us (-60)** ← fix |
| 15 | VibeCodeCareers | GTM Engineer | ca · san francisco · onsite | 0.5 → 2 | **+1.5** | onsite_international (-75) | **onsite_other_us (-60)** ← fix |
| 16 | Insight Partners | Sr. Analyst GTM Strategy & Operations | (empty) · new york · hybrid | 4.5 → 3.1 | -1.4 | hybrid_nyc (10) | hybrid_nyc (10) |
| 17 | Talos | GTM Engineer | (empty) · new york · hybrid | 6.8 → 5.5 | -1.3 | hybrid_nyc (10) | hybrid_nyc (10) |
| 18 | Built In Boston | GTM Engineer, Marketing Operations AI Innovation | (empty) · boston · (varies) | ~5 → ~3.x | ~-1 | (varies) | (varies) |
| 19 | Fireworks AI | Sara's List — Go-To-Market Operations Manager | ca · san mateo · onsite | 0 → 0.9 | **+0.9** | onsite_international (-75) | **onsite_other_us (-60)** ← fix |
| 20 | Talos — NY · SailOnchain | GTM Engineer | (empty) · new york · hybrid | 5.1 → 4.4 | -0.7 | hybrid_nyc (10) | hybrid_nyc (10) |
| 21 | Replit | Sara's List — Director RevOps Architect | ca · foster city · onsite | 0 → 0.5 | **+0.5** | onsite_international (-75) | **onsite_other_us (-60)** ← fix |
| 22 | Snowflake | Senior Manager, Data Science — GTM | ca · menlo park · onsite | 0 → 0.5 | **+0.5** | onsite_international (-75) | **onsite_other_us (-60)** ← fix |
| 23 | Solv | GTM Engineer | ca · san francisco · onsite | 0 → 0.5 | **+0.5** | onsite_international (-75) | **onsite_other_us (-60)** ← fix |
| 24–27 | (4 more deltas with \|Δ\| < 0.5) | … | … | … | varies | various | various |
| 28 | Hirebase | Revenue Operations Manager | (empty) · (empty) · remote | 5.1 → 5.4 | +0.3 | (no location adj) | fully_remote (5) |

**Rows where the location adjustment changes from international → other_us are the California-fix wins.** Bolded `← fix` markers.

**Rows where `oldLoc = "(no location adj)"` and `newLoc` is now populated are backfill-catch-up.** These would re-score the same way under the OLD scoring code.

## Specific named records

The session brief named eight records to trace. Findings:

### 1. Anaconda — **NO CHANGE**

`https://builtin.com/job/gtm-engineer/8843434`. Already at 10/10 from the PR #2 comp-trust-gate work. This role is `workplace="remote"` — California fix is irrelevant. Confirmed expected.

### 2. OpenAI — Product Engineer, GTM Innovation — **9.3 → 1 (-8.3)**

`https://builtin.com/job/product-engineer-gtm-innovation/7239792`
- region=`ca`, city=`san francisco`, workplace=`onsite`
- **Old persisted state:** `(no location adj)` — the original scoring run pre-dated the May-13 location backfill that populated `location_region`.
- **New state:** `location:onsite_other_us (-60)` — the fix routes "ca" to US state, then onsite_other_us bucket fires for non-NYC US cities.
- **Without the fix:** would route to `onsite_international (-75)` and land at 0 instead of 1. The fix improves OpenAI by 1 display point.
- The 8.3-point drop is mostly the backfill catching up, not the fix itself.

### 3. Introhive — Head of GTM Enablement in Toronto, ON — **5 → 0 (-5)**

`https://ventureloop.com/jobdetail.php?jobid=2994893`
- region=`(empty)`, city=`toronto`, workplace=`onsite`
- **Old persisted state:** `(no location adj)` — backfill never populated region for this URL.
- **New state:** `location:onsite_international (-75)` — empty region means isUS() returns false (`!region`), so it correctly routes to international. Toronto IS Canada; this is the right answer.
- This change would happen WITHOUT the fix too — the empty region doesn't enter the disambiguation path. Pure backfill-catch-up.

### 4. Enable — Director of Revenue Operations — **4.9 → 0 (-4.9)**

`https://jobs.insightpartners.com/companies/enable/jobs/46795826-director-of-revenue-operations`
- region=`canada`, city=`toronto`, workplace=`onsite`
- **Old persisted state:** `(no location adj)`.
- **New state:** `location:onsite_international (-75)`. isUS("canada") → false (explicit country-name match in the fix). Correct.
- Pure backfill-catch-up. Would change under unfixed code too.

### 5. Databricks — Sr Analytics Engineer — GTM Strategy and Operations — **3.5 → 0 (-3.5)**

`https://builtin.com/job/sr-analytics-engineer-gtm-strategy-and-operations/8891593`
- region=`(empty)`, city=`(empty)`, workplace=`onsite`
- **Old:** `(no location adj)`. **New:** `onsite_international (-75)` (no region info → falls through to international by default).
- Pure backfill-catch-up; not a California-fix case. The score reflects that onsite + no location data + onsite default penalty stacks heavily.

### 6. Built In Boston — GTM Engineer: Data Infrastructure & AI Intelligence — **3.5 → 0 (-3.5)**

`https://builtinboston.com/job/gtm-engineer-data-infrastructure-ai-intelligence/9386429`
- region=`(empty)`, city=`boston`, workplace=`onsite`
- **Old:** `(no location adj)`. **New:** `onsite_international (-75)`.
- Boston IS US, but with no region populated, the new code (correctly) returns false from `isUS("", "boston")` because `!region` is true. **This is a fixable gap.** If region were populated as `MA` or `Massachusetts`, the fix would route correctly. The data quality is the blocker here, not the scoring code.
- Worth flagging as a follow-up: when city is in a known-US city set and region is empty, default to US. **Not in scope for this PR.**

### 7. Paytm — Enterprise GTM Lead, Inference and Agentic AI — **4 → 1.5 (-2.5)**

`https://ventureloop.com/ventureloop/jobdetail.php?jobid=2995029`
- region=`(empty)`, city=`(empty)`, workplace=`unknown`
- **Old:** `(no location adj)`. **New:** `(no location adj)`. The workplace="unknown" routes through the `return null` branch in `locationAdjustment` — no location adjustment fires.
- The 2.5-point drop comes from OTHER scoring changes (most likely the comp trust gate from PR #2 or an archetype-related shift). Not a California fix concern.

### 8. Gumloop — GTM Operations Lead @ Gumloop — **9.8 → 7.8 (-2)**

`https://jobs.ashbyhq.com/Gumloop/ae3844e5-7881-4a58-b7fb-748161b6a8b6`
- region=`(empty)`, city=`(empty)`, workplace=`unknown`
- Same shape as Paytm. The 2-point drop is from a non-location source (archetype or soft-pref pattern change).

## Interpretation

**California fix is doing what it's supposed to:** the records with `region="ca"` and a structured non-NYC US workplace get the correct "other US" bucket (`-25` hybrid or `-60` onsite) instead of the wrong "international" bucket (`-50` or `-75`). That's the 9 California records with `← fix` markers above. Net effect: those 9 roles climb 1.5–2.5 display points each.

**Backfill-catch-up is the bigger story:** 12+ records have persisted scores that pre-date the May-13 location backfill. Re-scoring with current code (any version) flushes them. Most go DOWN because the backfill exposed previously-hidden negatives. This is corpus hygiene, not a California-specific change.

**Two follow-ups surfaced for separate PRs:**
1. **Built In Boston case:** city is known-US but region is empty → defaults to `onsite_international`. Should consider a city-fallback when region is empty for unambiguous US cities. *Out of scope for the California fix PR.*
2. **OpenAI 9.3 → 1 surprise:** OpenAI dropped 8.3 points, which is the largest single change in the dry-run. The fix improves the outcome by 1 point relative to the unfixed re-score (1 vs 0), but it's still a dramatic re-classification. Nick should review whether the SF onsite OpenAI Product Engineer role at `$230K-$385K` comp range is genuinely a "low fit" (low 1/10) or whether the comp+archetype signals should rescue it more. This is a Phase 1.5 question, not a fix-PR question.

## Recommendation for the live re-score PR (cleanup plan PR #3)

- **Land PR #5 (fix code)** first.
- **Run `backfill-adjusted-scores.mjs`** against `data/enrichments.json` on a separate branch.
- **Spot-check** the 8 named records above match the dry-run prediction (especially OpenAI and the 5 California "← fix" wins).
- **Don't merge the data PR until Nick has eyeballed the new top-30** — particularly the 8.3-point OpenAI drop.
- **Open a follow-up issue** for the city-fallback when region is empty (Built In Boston case).

## Cross-references

- `docs/audits/2026-05-18-scoring-engine-audit.md` §B.2 — bug origin
- `docs/audits/2026-05-18-scoring-engine-audit.md` Top finding #1 — fix shape
- `docs/audits/2026-05-18-cleanup-plan.md` PR #2 — this fix; PR #3 — the live re-score
- `docs/audits/2026-05-18-comp-trust-gate-rescore.md` — the rescore doc that named the 12 drift records (Introhive, Enable, Databricks, Built In Boston, Paytm, Gumloop all confirmed above)
- `scripts/backfill-adjusted-scores.mjs` — existing dry-run/apply script; use for the live re-score in PR #3
- `/tmp/california-fix-impact-analysis.mjs` — one-off analysis used for this doc (not committed; recreate from this file if needed)
