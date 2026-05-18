# Codebase Review — 2026-05-18

Post-shipping audit after 3 days of intensive work (feat/polish-1, feat/personalab-improvements, PR #1 canonical predicate, comp trust gate, misc fixes).

**Scope:** Read-only inventory. No fixes, no commits.

---

## 1. Executive Summary

- **3-way duplication of FUZZY_SUFFIXES** across `scripts/lib/company-aggregator.mjs`, `scripts/lib/company-archetype-matcher.mjs`, and `dashboard-web/lib/role-matching.ts`. Guarded by a test pin, but the underlying pattern (copy-paste + sync comment) doesn't scale.
- **`hasRealComp()` duplicated verbatim** in `scripts/lib/analytics-rollup.mjs` and `dashboard-web/lib/source-detail.ts` with a stale cross-reference comment pointing to the wrong file (`source-health.ts` instead of `source-detail.ts`).
- **PRIMARY_ARCHETYPES duplicated** in two scripts files with no sync comment and mismatched data structures (Set vs Array).
- **Comp floor ($200K) defined in 7 places** — config, archetypes, test fixtures, and hardcoded UI strings. Single-source-of-truth violation.
- **Fit score thresholds (4/6/7) hardcoded** in 9+ places across `generate-briefing.mjs` and `scan-jobs.mjs` with no centralized constants.
- **Zero test coverage on `getRoles()`, `computeScore()`, `parseApplications()`, `parseScanReport()`** — the entire dashboard data pipeline entry point. The `open_roles_count` fallback-to-zero is also untested.
- **11 orphaned scripts** in `scripts/` not referenced from `package.json` or documentation (backfill-*, migrate-*, prune-stale, etc.).
- **Scoring engine spans 15+ files** across two runtimes with 4 distinct scoring paths (enriched, heuristic, application override, backtest hypothetical). Only the adjustment layer (`scoring-layer.mjs`) has thorough tests.
- **Only 1 explicit TODO** in source code (`data.ts:321` — reconcile scoring paths), but **15 ISSUE-tracked bugs** in QA report, several still open.
- **`analyze-patterns.mjs` referenced in CLAUDE.md** but missing from `package.json` scripts.

---

## 2. Structural Duplication and Cross-Runtime Drift

### 2.1 FUZZY_SUFFIXES (3-way, guarded)

| File | Line | Form |
|------|------|------|
| `scripts/lib/company-aggregator.mjs` | 39 | `const FUZZY_SUFFIXES = ["ai","labs","tech","io","hq","app","xyz"]` |
| `scripts/lib/company-archetype-matcher.mjs` | 21 | `const COMPANY_SUFFIXES = ["ai","labs","tech","io","hq","app","xyz"]` |
| `dashboard-web/lib/role-matching.ts` | 36 | `const FUZZY_SUFFIXES = ["ai","labs","tech","io","hq","app","xyz"] as const` |

Explicit sync comment at `company-aggregator.mjs:32-38`: *"change all three together."*
Test pin at `canonical-counts-integration.test.ts:117-129` guards the array content.

**Drift:** None currently. But the variable is named differently in `company-archetype-matcher.mjs` (`COMPANY_SUFFIXES`), which makes grep-based auditing harder.

### 2.2 candidateKeys() (3-way, implicit)

| File | Line | Function Name | Null Handling |
|------|------|---------------|---------------|
| `scripts/lib/company-aggregator.mjs` | 41-52 | `aggregatorCandidateKeys()` | Defensive: `companyKey(slug) \|\| String(slug).toLowerCase()...` |
| `scripts/lib/company-archetype-matcher.mjs` | 28-36 | `candidateKeys()` | Assumes pre-normalized input, no fallback |
| `dashboard-web/lib/role-matching.ts` | 65-76 | `companyCandidateKeys()` | Defensive: same as aggregator |

**Drift:** `company-archetype-matcher.mjs` lacks the defensive fallback the other two share. If called with raw (non-normalized) input, it will silently produce different candidate keys.

### 2.3 hasRealComp() (2-way, stale comment)

| File | Line |
|------|------|
| `scripts/lib/analytics-rollup.mjs` | 444-464 |
| `dashboard-web/lib/source-detail.ts` | 114-133 |

Logic is identical line-for-line. Both share `EMPTY_COMP_VALUES` Set and `QUALITATIVE_COMP_RE` regex.

**Issue:** Sync comment at `analytics-rollup.mjs:441` references `source-health.ts` but the code lives in `source-detail.ts`. Stale after a file reorganization.

### 2.4 PRIMARY_ARCHETYPES (2-way, no sync comment)

| File | Line | Data Structure |
|------|------|----------------|
| `scripts/lib/company-aggregator.mjs` | 30 | `new Set(["gtm-engineering","ai-operations","fde"])` |
| `scripts/lib/company-archetype-matcher.mjs` | 18 | `["gtm-engineering","ai-operations","fde"]` (Array) |

**No cross-reference comment.** No test pin. Different data structures (Set vs Array). If archetypes change, this will silently diverge.

### 2.5 matchesHostList() (2-way, documented)

| File | Line |
|------|------|
| `scripts/lib/source-classification.mjs` | 33-36 |
| `dashboard-web/lib/source-classification.ts` | 19-22 |

Both read from `config/source-classification.json` (good). Helper function logic is identical. Documented at `source-classification.ts:18`.

### 2.6 All "Change These Together" Comments

| File | Line | Cross-references |
|------|------|-----------------|
| `scripts/lib/company-aggregator.mjs` | 32-38 | 3 files: aggregator, matcher, role-matching.ts |
| `dashboard-web/lib/role-matching.ts` | 36-38 | matcher.mjs COMPANY_SUFFIXES |
| `dashboard-web/lib/source-classification.ts` | 18 | scripts/lib/source-classification.mjs |
| `dashboard-web/lib/source-detail.ts` | 113 | scripts/lib/analytics-rollup.mjs:hasRealComp |
| `scripts/lib/analytics-rollup.mjs` | 441 | dashboard-web/lib/source-health.ts (**STALE — should be source-detail.ts**) |
| `dashboard-web/lib/company-detail.ts` | 16 | scripts/lib/company-aggregator.mjs (type mirror) |
| `dashboard-web/lib/company-detail.test.ts` | (comment) | scripts/lib/company-aggregator.test.mjs (shared fixture shape) |

---

## 3. Dead Code and Unused Exports

### 3.1 Unused Config Keys

`config/user-context.yaml:7-10` — `identity.home_city`, `identity.home_state`, `identity.home_country` are defined but never referenced in any `.ts` or `.mjs` consumer. Zero grep hits outside the config file itself.

### 3.2 Orphaned Scripts (11 files)

These exist in `scripts/` but are not referenced in `package.json`, CLAUDE.md, or any other code:

| Script | Likely Purpose |
|--------|---------------|
| `scripts/backfill-adjusted-scores.mjs` | Re-apply scoring layer after config change |
| `scripts/backfill-analytics-from-state.mjs` | One-time analytics migration |
| `scripts/backfill-archetypes.mjs` | Archetype tagging migration |
| `scripts/backfill-jd-quality.mjs` | JD quality scoring migration |
| `scripts/backfill-locations.mjs` | Location data migration |
| `scripts/check-location-reclassification.mjs` | Location audit utility |
| `scripts/migrate-seen-urls.mjs` | Data migration |
| `scripts/prune-stale.mjs` | Stale data cleanup |
| `scripts/rescan-locations.mjs` | Location re-parsing |
| `scripts/review-promotions.mjs` | Promotion review utility |
| `scripts/sync-score-feedback.mjs` | Score override reconciler |

Note: `sync-score-feedback.mjs` is actively used in the scoring flow (writes `score-overrides.json`) but has no `package.json` entry. The backfill scripts may be intentionally ad-hoc, but they reference internal APIs that may have drifted.

### 3.3 Missing package.json Entry

`analyze-patterns.mjs` — referenced in CLAUDE.md and `modes/patterns.md` but absent from `package.json` scripts section.

---

## 4. Config Sprawl

### 4.1 Compensation Floor — 7 Occurrences (CRITICAL)

| File | Line | Value | Form |
|------|------|-------|------|
| `config/user-context.yaml` | 29 | `200000` | `compensation.floor_usd` (canonical) |
| `config/archetypes.yaml` | 165 | `200000` | `global_disqualifiers.comp_below` |
| `scripts/generate-briefing.mjs` | 119 | `"$200K+"` | Hardcoded fallback goal string |
| `dashboard-web/app/api/chat/route.ts` | 87 | `"$200K+"` | Hardcoded fallback goal string |
| `autoapply/chrome-extension/popup/popup.js` | 36 | `200000` | `salary_floor_usd` default |
| `autoapply/tests/test_apply_cli.py` | 43 | `200000` | Test fixture |
| `personalab/tests/fixtures/valid_persona.yaml` | 10 | `200000` | Test fixture |

Changing the floor requires touching 4+ files minimum.

### 4.2 Fit Score Thresholds — 9+ Hardcoded Instances

| Threshold | File | Line | Context |
|-----------|------|------|---------|
| 4 (promotion min) | `scripts/lib/promote-company.mjs` | 48 | `MIN_FIT_SCORE_FOR_PROMOTION` (centralized constant) |
| 6 (briefing apply) | `scripts/generate-briefing.mjs` | 184 | `.filter(r => r.fit_score >= 6)` — hardcoded |
| 6 (briefing verify) | `scripts/generate-briefing.mjs` | 215 | `.filter(r => r.fit_score >= 6)` — hardcoded |
| 7 (briefing missed) | `scripts/generate-briefing.mjs` | 206 | `.filter(r => r.fit_score >= 7)` — hardcoded |
| 4-6 (recalibration) | `scripts/generate-briefing.mjs` | 226 | `.filter(r => r.fit_score >= 4 && r.fit_score <= 6)` — hardcoded |
| 4.0 (confidence) | `scripts/scan-jobs.mjs` | 575 | `score += 2; // Eval was >= 4.0/5` — hardcoded |
| 4.0 (conflict) | `scripts/sync-score-feedback.mjs` | 142, 149 | `maxScore >= 4.0` — hardcoded |

### 4.3 Scoring Magic Numbers (scoring-layer.mjs)

| Line | Value | What |
|------|-------|------|
| 271 | `35` | Stablecoin-tier Web3 company boost |
| 272 | `12` | Tier-1 Web3 company boost |
| 273 | `6` | Tier-2 Web3 company boost |
| 278 | `8` | Title high-match bonus |
| 279 | `4` | Title medium-match bonus |

These are buried in source code. Should be in `config/archetypes.yaml` or similar.

### 4.4 Hardcoded Goal Strings (2 independent copies)

- `scripts/generate-briefing.mjs:119` — `"GTM Engineer / RevOps roles, NYC area or remote, $200K+ floor, Series B+ companies"`
- `dashboard-web/app/api/chat/route.ts:87` — same string, independent copy

Both are fallbacks for when `modes/_profile.md` doesn't exist.

### 4.5 Time Thresholds

| Value | File | Line |
|-------|------|------|
| 30 days (chat pruning) | `scripts/generate-briefing.mjs` | 362 |
| 3 days (stale application) | `scripts/generate-briefing.mjs` | 199 |

Hardcoded, should be constants.

### 4.6 `target_usd` Asymmetry

`config/user-context.yaml` defines `compensation.target_usd: 240000` but it's only read by `autoapply/cli/apply.py` — not used in the main scoring layer, briefing, or dashboard. The floor is enforced everywhere; the target isn't.

---

## 5. Test Coverage Gaps

### 5.1 Dashboard Data Pipeline — ZERO TESTS (CRITICAL)

The entire `dashboard-web/lib/data.ts` entry point (`getRoles()`, line 152) that feeds every dashboard surface has no tests. Untested functions:

| Function | Line | Blast Radius |
|----------|------|-------------|
| `getRoles()` | 152 | **All roles displayed anywhere** — calls parseScanReport + parseApplications + computeScore |
| `computeScore()` | 706-740 | Every non-enriched role's score — title keyword matching, location bonus, seniority |
| `parseApplications()` | 49-72 | applications.md parsing — markdown table regex, missing columns |
| `parseScanReport()` | 94-147 | Scan report parsing — bold score regex `**7**`, markdown links |
| `explainScore()` | 742-769 | Score justification text |
| `isJunkUrl()` | 964-966 | 23 URL filter patterns |
| `isJunkTitle()` | 968-970 | 12 title filter patterns |
| `isFalsePositiveTitle()` | 972-975 | 12 titles hard-capped at score 3 |
| `cleanCompany()` | 814-829 | SLUG_NAMES lookup (40+ entries), normalization |
| `mapStatus()` | 74-89 | Status string normalization |
| `readJsonSafe()` | 28-35 | JSON fallback — no distinction between missing file and malformed JSON |

### 5.2 Untested Fallback Paths

| Path | File:Line | What Happens |
|------|-----------|-------------|
| Score priority fallback | `data.ts:301` | `scanData?.score \|\| computeScore(...)` — when does scan data exist vs not? |
| Pre-enrichment cap | `data.ts:312-315` | `score > 7 → capped to 7` for non-enriched roles |
| Stale exclusion list | `data.ts:348` | Hardcodes `["Interview","Applied","Offer"]` — new statuses break gate |
| Source fallback chain | `data.ts:365` | `meta.source \|\| scanData?.source \|\| "Unknown"` — 3-tier, only first tested |
| open_roles_count zero | `signals-client.tsx:30` | Defaults to 0 when match missing — user sees "0 roles" incorrectly |

### 5.3 Pipeline Integrity Tools — No Tests

`verify-pipeline.mjs`, `normalize-statuses.mjs`, `merge-tracker.mjs` have no automated tests. If `CANONICAL_STATUSES` or `ALIASES` mappings change, nothing catches regressions.

### 5.4 What IS Well Tested

- `role-matching.ts` — comprehensive unit + integration tests (PR #1 work)
- `scoring-layer.mjs:adjustScore()` — 5+ tests including comp trust gate
- `source-health.ts:computeSourceHealth()` — thorough
- `qa-reports.ts` — regression test for ISSUE-001

---

## 6. Scoring Engine Surface Enumeration

### 6.1 File Inventory (15 files)

**Calculation:**
| File | Role |
|------|------|
| `scripts/lib/scoring-layer.mjs` | Core G4 adjustment layer: `adjustScore()` + 6 sub-adjusters |
| `scripts/lib/archetype-classifier.mjs` | `classifyArchetype()` — tags roles with primary/secondary archetypes |
| `scripts/enrich-roles.mjs` | Orchestrator: Claude → classify → adjust → write enrichments.json |
| `dashboard-web/lib/data.ts` | `computeScore()` — heuristic fallback; `getRoles()` — score merging |

**Adjustment emitters:**
| File | What It Writes |
|------|---------------|
| `scripts/lib/scoring-layer.mjs` | `score_adjustments[]` array → enrichments.json |
| `scripts/lib/meta-scorer.mjs` | Rule proposals → `data/rule-proposals/YYYY-MM-DD.jsonl` |
| `scripts/lib/backtest-engine.mjs` | Hypothetical deltas → in-memory / API response |
| `scripts/sync-score-feedback.mjs` | `score-overrides.json` (boost/penalize/block) |

**Storage:**
| File | Score Fields |
|------|-------------|
| `data/enrichments.json` | `fit_score`, `score_base`, `score_adjusted`, `score_adjustments[]`, `score_disqualified` |
| `data/score-overrides.json` | `boost`, `penalize`, `block` per company key |
| `data/seen-urls.json` | Raw scan data (no scoring) |
| Scan report `.md` files | Heuristic scores in bold markdown |

**Display (consumers):**
| File | What It Shows |
|------|--------------|
| `dashboard-web/components/ScorePill.tsx` | Score badge with tier colors + provenance dot |
| `dashboard-web/components/PipelineTable.tsx` | Score column, sortable, min-score filter |
| `dashboard-web/components/ExpandedRow.tsx` | Score + provenance explanation + verdict |
| `dashboard-web/app/companies/[slug]/company-detail-client.tsx` | `score_base` → `score_adjusted` pair |
| `dashboard-web/app/context/_components/PreferencesPanel.tsx` | User-context deltas display |

**Configuration (inputs):**
| File | What It Feeds |
|------|--------------|
| `config/user-context.yaml` | Location deltas, comp floor, soft prefs, anti-signals, hard nos |
| `config/archetypes.yaml` | 5 archetypes with `reward_signals` keywords + weights, global disqualifiers |
| `config/backtest-config.yaml` | `sample_size_min` for meta-scorer |

### 6.2 Four Scoring Paths

1. **Enriched** — Claude fit_score → adjustScore() → enrichments.json → getRoles() reads `fit_score`
2. **Heuristic** — scan-jobs.mjs title match → scan report bold score → getRoles() reads scan data OR falls back to `computeScore()`; capped at 7
3. **Application override** — sync-score-feedback.mjs parses applications.md → writes score-overrides.json → getRoles() applies boost/penalize/block
4. **Backtest hypothetical** — backtest-engine.mjs calls adjustScore() twice (current vs proposed) → returns delta; never persisted

### 6.3 Key Constants

| Constant | File | Value | Scale |
|----------|------|-------|-------|
| `SCALE` | scoring-layer.mjs | 10 | fit_score×10 → internal 0-100 |
| `ARCHETYPE_REWARD_CAP` | scoring-layer.mjs | 25 | Max archetype contribution (0-100 scale) |
| `SECONDARY_CAP` | scoring-layer.mjs | 0.5 | Secondary archetype at 50% of primary |
| Pre-enrichment cap | data.ts:312 | 7 | Non-enriched roles capped |
| False-positive cap | data.ts | 3 | Junk titles capped |
| Min pipeline filter | PipelineTable.tsx | 4 | Default UI filter |

---

## 7. TODO / FIXME / HACK Inventory

### 7.1 Explicit Code TODOs

| File | Line | Comment |
|------|------|---------|
| `dashboard-web/lib/data.ts` | 321 | `"Phase 11 TODO: reconcile the two scoring paths"` — score-overrides.json uses eval×2 (/10) vs scan-jobs.mjs coarse +2/min(4) |

### 7.2 ISSUE-Tracked Bugs (from QA report)

Source: `docs/qa-reports/2026-05-17-gstack-feat-polish-1.md`

| Issue | Severity | Status | Title |
|-------|----------|--------|-------|
| ISSUE-001 | CRITICAL | Fixed | /qa-reports crashes with YAML parser error |
| ISSUE-002 | HIGH | Fixed (PR #1) | Same company has 3 different counts across views |
| ISSUE-003 | HIGH | Open | Sidebar "Signals" badge changes across routes |
| ISSUE-004 | HIGH | Open | Signal→Pipeline bridge sets search but not filters |
| ISSUE-005 | HIGH | Fixed | /analytics route loses sidebar |
| ISSUE-006 | HIGH | Open | Analytics funnel disagrees with /today + /pipeline counts |
| ISSUE-007 | MEDIUM | Open | Pipeline header reports 3 inconsistent totals |
| ISSUE-008 | MEDIUM | Open | Company list ↔ drilldown role counts disagree |
| ISSUE-009 | MEDIUM | Open | Duplicate-looking rows in Open Roles, no disambiguation |
| ISSUE-010 | MEDIUM | Open | "View in pipeline" link not wired; company link doesn't navigate |
| ISSUE-011 | LOW | Open | "Never show this company again" — one-click destructive, no confirm |
| ISSUE-012 | LOW | Open | Title casing, name parsing, truncated pills |
| ISSUE-013 | LOW | Open | Singular/plural copy and badge case |
| ISSUE-014 | LOW | Open | /api/qa-reports 500 returns empty body |
| ISSUE-015 | LOW | Open | Next.js dev warning: multiple lockfiles |

### 7.3 Deferred Items (PHASE_11_TODO.md)

| Item | Description |
|------|-------------|
| Config-driven scoping | "the cluster the dashboard treats as 'in scope' should be config-driven" |
| Location clustering updates | Deferred from hybrid-CA classification work (2026-05-13) |
| Design system upstream sync | Pending coordinated multi-branch push |

### 7.4 Implicit TODOs ("should be" comments)

| File | Line | Comment |
|------|------|---------|
| `docs/PHASE_11_TODO.md` | 9 | "the cluster the dashboard treats as 'in scope' should be config-driven" |
| `docs/backend-data-audit.md` | 90 | T1-1 "should be reframed from 'build /context' to 'fix empty-state rendering'" |

### 7.5 Stale Cross-Reference

| File | Line | Issue |
|------|------|-------|
| `scripts/lib/analytics-rollup.mjs` | 441 | References `source-health.ts` but code is in `source-detail.ts` |

---

## 8. Refactor Recommendations

### P0 — Fix Before Next Feature Work

| # | Item | Effort | ROI |
|---|------|--------|-----|
| 1 | **Add tests for `getRoles()` / `computeScore()` / `parseScanReport()`** — the entire dashboard data pipeline is untested. Any future change risks silent breakage. | 4-6h | Highest — prevents regression on every subsequent change |
| 2 | **Extract shared constants** — create `scripts/lib/shared-constants.mjs` with `FUZZY_SUFFIXES`, `PRIMARY_ARCHETYPES`, `hasRealComp()`. Import everywhere instead of copy-paste. Eliminates 3 sync points. | 2-3h | High — removes a class of bugs permanently |
| 3 | **Centralize comp floor** — single source in `config/user-context.yaml`, read by all consumers. Remove duplicates from `archetypes.yaml`, hardcoded strings, test fixtures (use dynamic import). | 1-2h | High — currently requires 4+ file edits for one config change |

### P1 — Address Within Next Sprint

| # | Item | Effort | ROI |
|---|------|--------|-----|
| 4 | **Centralize fit score thresholds** — extract constants for the 6/7/4-6 briefing thresholds and the 4.0 confidence threshold. Put in `scripts/lib/thresholds.mjs` or `config/`. | 1h | Medium — prevents subtle threshold drift |
| 5 | **Fix stale cross-reference** in `analytics-rollup.mjs:441` (source-health.ts → source-detail.ts). | 5min | Low effort, prevents wrong-file debugging |
| 6 | **Add sync comment + test pin for PRIMARY_ARCHETYPES** (aggregator.mjs + matcher.mjs). Follow the FUZZY_SUFFIXES pattern. | 30min | Medium — prevents silent archetype divergence |
| 7 | **Reconcile scoring paths** (the Phase 11 TODO at `data.ts:321`). score-overrides.json uses eval×2 while scan-jobs.mjs uses coarse +2/min(4). | 2-3h | Medium — scoring inconsistency |
| 8 | **Move scoring magic numbers** (Web3 boosts 35/12/6, title signals 8/4) from `scoring-layer.mjs` source code into `config/archetypes.yaml`. | 1-2h | Medium — makes tuning possible without code changes |
| 9 | **Archive or document orphaned scripts** — the 11 `scripts/backfill-*` etc. files. Either add to package.json with descriptions or move to `scripts/archive/`. | 30min | Low — reduces confusion |

### P2 — When Convenient

| # | Item | Effort | ROI |
|---|------|--------|-----|
| 10 | **Add `analyze-patterns.mjs`** to package.json scripts. | 5min | Trivial |
| 11 | **Remove unused identity fields** from `config/user-context.yaml` (home_city/state/country) or implement them. | 15min | Low |
| 12 | **Normalize PRIMARY_ARCHETYPES data structure** — both files should use Set (or both Array). | 15min | Low — consistency |
| 13 | **Add pipeline integrity tests** for verify-pipeline.mjs, normalize-statuses.mjs, merge-tracker.mjs. Snapshot-style tests for CANONICAL_STATUSES and ALIASES. | 2-3h | Medium — catches mapping regressions |
| 14 | **Unify goal fallback strings** — one source for the "GTM Engineer / RevOps..." fallback in briefing and chat API. | 15min | Low |
| 15 | **Test `isStale` exclusion list** at `data.ts:348` — hardcoded `["Interview","Applied","Offer"]`. New statuses will cause false staleness. | 30min | Medium — prevents data display bugs |

---

## Top 5 Things to Fix First

1. **Test the dashboard data pipeline** (`getRoles`, `computeScore`, `parseScanReport`, `parseApplications` in `data.ts`). This is the single source of truth for every role displayed — zero tests is unacceptable after the scoring work that just landed. (~4-6h)

2. **Extract FUZZY_SUFFIXES, PRIMARY_ARCHETYPES, and hasRealComp() into a shared module.** Three copy-paste sync points is three future bugs. The test pin helps but doesn't fix the root cause. (~2-3h)

3. **Centralize the comp floor to one source of truth.** 7 occurrences of `200000` across config files, test fixtures, and hardcoded strings. Change it once, not four times. (~1-2h)

4. **Centralize fit score thresholds (4/6/7).** 9+ hardcoded instances across briefing and scan code. Extract to named constants so tuning is intentional. (~1h)

5. **Fix the stale cross-reference + add PRIMARY_ARCHETYPES sync comment.** Two 5-minute fixes that prevent future debugging wild goose chases. (~15min total)
