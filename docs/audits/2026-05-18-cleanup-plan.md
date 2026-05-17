# Cleanup Plan — 2026-05-18

**Scope:** read-only synthesis of three prerequisite audits + three explicit known-debt items into an executable, PR-sequenced cleanup plan. No code in this doc.

**Inputs:**
- `docs/audits/2026-05-18-codebase-review.md` (Prompt 1) — structural audit, dead code, config sprawl, test gaps
- `docs/audits/2026-05-18-scoring-engine-audit.md` (Prompt 2) — Phase A–E engine trace
- `docs/audits/2026-05-18-comp-trust-gate-rescore.md` — post-PR #2 re-score (the 12 drift records)
- The 3 known-debt items in the Prompt 3 brief: drift records, three "floor" values, FUZZY_SUFFIXES cross-runtime duplication

**Out of cleanup scope (deferred to a separate decision after Prompt 2 is reviewed):** scoring math changes — `global_disqualifiers.location` activation, dashboard switching from `fit_score` to `score_adjusted`, trust-gate ceiling cap (Anaconda 10/10 smell), floor-clamp observability, scoring-paths reconcile, Web3-boost magnitude reconciliation. These change scoring behavior, not structure. They need Nick's read of the scoring audit before PRs are shaped.

**Active in parallel (this session's brief, not part of this cleanup plan but referenced from PR #2/#3):** California-is-Canada fix (`fix/california-is-canada` branch) and its dry-run impact (`docs/audits/2026-05-18-california-fix-impact.md`).

---

## 1. Inventory

Organized by category, with cross-references to the source reports. Each item lists the debt, why it's debt, fix shape (approach only, no code), effort, dependencies, and risk tier (P0 = before productize, P1 = soon, P2 = nice to have).

### Category A — Cross-runtime duplication

| # | Item | What | Why it's debt | Fix shape | Effort | Risk | Source |
|---|---|---|---|---|---|---|---|
| A1 | `FUZZY_SUFFIXES` 3-way | Same array `["ai","labs","tech","io","hq","app","xyz"]` in `scripts/lib/company-aggregator.mjs:39`, `scripts/lib/company-archetype-matcher.mjs:21` (as `COMPANY_SUFFIXES`), and `dashboard-web/lib/role-matching.ts:36`. Guarded by sync comment + test pin (`canonical-counts-integration.test.ts:117-129`). | Three copy-paste sites = three future drift bugs. The test pin patches the symptom (catches drift after it happens); it doesn't remove the root cause. Variable name mismatch in `company-archetype-matcher.mjs` (`COMPANY_SUFFIXES`) defeats grep-based auditing. | Single source — `config/role-matching.json` (or equivalent) — read at runtime by both sides. TS reads via JSON import, `.mjs` reads via `JSON.parse(fs.readFileSync(...))`. Existing test pin stays (now asserts JSON loader equality). | 4–6h | P1 | codebase 2.1; user known #3 |
| A2 | `candidateKeys()` 3-way drift (real) | Function in 3 files: `company-aggregator.mjs:41-52`, `company-archetype-matcher.mjs:28-36`, `role-matching.ts:65-76`. Aggregator + dashboard share defensive `companyKey(slug) \|\| String(slug).toLowerCase()...` fallback; matcher.mjs does NOT and assumes pre-normalized input. | This is a real silent-drift bug, not just duplication. Calling matcher.mjs with raw input produces different candidate keys than the other two — affects archetype tagging for any pre-normalization gap. | Subsumed by A1 if the shared module exposes the function. Otherwise: copy the defensive fallback into matcher.mjs and add a test that asserts the three implementations agree on a fixture of raw inputs. | 1h (or 0 if A1 lands first) | P1 | codebase 2.2 |
| A3 | `hasRealComp()` 2-way + stale comment | Identical impl in `scripts/lib/analytics-rollup.mjs:444-464` and `dashboard-web/lib/source-detail.ts:114-133`. Both share `EMPTY_COMP_VALUES` Set + `QUALITATIVE_COMP_RE` regex. Sync comment at `analytics-rollup.mjs:441` points to `source-health.ts` (wrong file). | Same 3-way drift risk as A1, smaller blast. Stale comment causes wasted debugging cycles. | Move helper + constants to a shared module imported by both. Same cross-runtime constraint as A1. Stale comment fix is a 5-min sub-PR if A1/A3 don't land soon. | 2h (or 5 min for just the comment) | P1 (comment fix: P2) | codebase 2.3, 7.5 |
| A4 | `PRIMARY_ARCHETYPES` 2-way mismatched | `company-aggregator.mjs:30` declares `new Set([...])`; `company-archetype-matcher.mjs:18` declares the same items as `Array`. No sync comment. No test pin. | Different data structures will diverge silently. Already mismatched in shape, just not yet in content. | Either subsume into A1 shared module, or add sync comment + test pin (cheap interim if A1 deferred). | 30 min sync-comment patch / 0 if A1 lands first | P1 | codebase 2.4 |
| A5 | `matchesHostList()` 2-way | `scripts/lib/source-classification.mjs:33-36` and `dashboard-web/lib/source-classification.ts:19-22`. Both read from `config/source-classification.json` (good — already shares config). Helper logic duplicated. | Already documented, has good shape. The helper is tiny and reads from shared JSON, so risk is low. | Optional — skip unless A1 pattern is generalized. If A1 lands, drop A5 into the same shared module. | 30 min | P2 | codebase 2.5 |

### Category B — Config sprawl & duplication

| # | Item | What | Why it's debt | Fix shape | Effort | Risk | Source |
|---|---|---|---|---|---|---|---|
| B1 | Comp-floor split 4 ways (the "three-floor problem" — verified as **four**) | (1) `config/user-context.yaml:29` `floor_usd: 200000` — **engine-consumed**. (2) `config/archetypes.yaml:165` `global_disqualifiers.comp_below: 200000` — **validated-only, never read at scoring time** (scoring E.2, E.3). (3) `modes/_profile.md:76,84,168` — **"$190K floor"** — sent to Claude in the verdict prompt; numeric mismatch with engine. (4) `config/profile.yml:60` `target_range: "$150K-200K"` — different field (target range, not floor). Plus 4 more hardcoded copies catalogued in codebase 4.1 (briefing fallback string, chat API fallback string, autoapply popup, autoapply + personalab test fixtures). | Decision F in the handoff says Phase 2 reconciles this. Right now: changing the floor for any future tier requires touching 4+ files. The $190K vs $200K mismatch is already drift — Claude evaluates against $190K, engine penalizes against $200K. Test fixtures in `scripts/lib/scoring-layer.test.mjs:109,180` use "$190K" verdict text against the $200K engine floor, embedding the inconsistency into tests. | (a) Single source of truth = `config/user-context.yaml:compensation.floor_usd`. (b) Drop `archetypes.yaml:global_disqualifiers.comp_below` (validator-only — codebase confirms zero scoring readers). (c) Template the Claude prompt — `modes/_profile.md` floor line gets a `{{floor_usd}}` placeholder; `generate-briefing.mjs` substitutes at prompt-assembly time. If templating is too heavy, document the mirror explicitly with a sync comment + test that asserts the mode file's number equals the config value. (d) Briefing + chat API fallback strings: build them from the config value, not hardcoded. (e) Autoapply popup + test fixtures: read from config or import. | 4–6h | **P0** (blocks Phase 2 per Decision F) | codebase 4.1, 4.6; scoring E.3; user known #2 |
| B2 | Fit-score thresholds (9+ hardcoded instances) | `4` (promotion min — centralized), `6` (briefing apply/verify — hardcoded x2), `7` (briefing missed — hardcoded), `4-6` (recalibration range — hardcoded), `4.0` (scan-jobs confidence — hardcoded), `4.0` (sync-score-feedback conflict — hardcoded x2). Only `MIN_FIT_SCORE_FOR_PROMOTION` in `promote-company.mjs:48` is a named constant. | Tuning the briefing threshold "should be a 1-line config change." Today it's a sweep across `generate-briefing.mjs` and `scan-jobs.mjs`. Each call site is one chance to miss. | New file `scripts/lib/thresholds.mjs` exporting named constants. All call sites import and use them. Optional: surface tunables in `config/user-context.yaml` if Nick wants live-tunable. | 2h | P1 | codebase 4.2 |
| B3 | Scoring magic numbers in source | `scoring-layer.mjs:271-279` Web3 boosts (`+35/+12/+6`) + title bonuses (`+8/+4`). Plus `archetype-classifier.mjs:154-160` (`+60/+20/+10`) — same Web3 tiers, different magnitudes (see scoring E.3 "DRIFT" row). Plus `SECONDARY_CAP=0.5`, `ARCHETYPE_REWARD_CAP=25`, `SCALE=10` (`scoring-layer.mjs:27-29`). | Tuning archetype weights or institutional boosts requires source edits. Worse: classifier (60/20/10) and scoring-layer (35/12/6) emit different magnitudes from the same `institutional_companies_boost` config — they look like they read one source but emit divergent numbers. This is *math drift*, not just code drift. | Move magnitudes into `config/archetypes.yaml` (e.g., `institutional_companies_boost.classifier_weights` and `.scoring_weights`, OR unify to one weight column). Read both call sites from config. SCALE/CAP stay in code (structural). Mark this as a **structural-only** change: do NOT change the magnitudes during this PR, just move them. Math reconciliation (do classifier + scoring layer want the same magnitudes?) is a separate scoring-math decision. | 2–3h | P1 | codebase 4.3; scoring E.3 |
| B4 | Goal-string fallback duplicated | `scripts/generate-briefing.mjs:119` and `dashboard-web/app/api/chat/route.ts:87` both hardcode `"GTM Engineer / RevOps roles, NYC area or remote, $200K+ floor, Series B+ companies"`. Fallbacks for when `modes/_profile.md` is missing. | Two independent copies of a user-facing narrative. The "$200K" inside the string is a fifth comp-floor copy that B1 won't catch unless extended. | One source — `scripts/lib/default-goal.mjs` (or read from a `profile.yml` field). Both fallbacks import. If templated against the floor (B1), the string becomes dynamic. | 30 min | P2 | codebase 4.4 |
| B5 | Time thresholds hardcoded | `30` (chat pruning, `generate-briefing.mjs:362`), `3` (stale application, `generate-briefing.mjs:199`). | Tuning windows requires source edits. Low blast, but no reason to leave hardcoded once B2 lands. | Fold into B2's `thresholds.mjs` (rename `scripts/lib/constants.mjs`). | Folded into B2 | P2 | codebase 4.5 |
| B6 | `target_usd` asymmetry | `config/user-context.yaml:compensation.target_usd: 240000` consumed only by `autoapply/cli/apply.py`. Not used by scoring, briefing, or dashboard. Floor is enforced everywhere; target is silent. | Either it should matter at scoring time, or it shouldn't exist outside autoapply. Right now it's a half-implemented signal. | **Decision needed** — either (a) wire it into scoring/briefing as a soft target boost, or (b) move to `autoapply/config/` or rename the user-context key to `autoapply_target_usd`. Either way, document the scope. | 1h (option b — purely organizational) | P2 | codebase 4.6; scoring E.1 |

### Category C — Dead config & orphaned scripts

| # | Item | What | Why it's debt | Fix shape | Effort | Risk | Source |
|---|---|---|---|---|---|---|---|
| C1 | Unused `identity.*` fields | `config/user-context.yaml:7-10` — `home_city`, `home_state`, `home_country`. Zero readers outside the config file. | Misleads readers; suggests location classification uses these (it doesn't — it uses `archetypes.yaml` + per-role location parsing). | Delete the keys. Update `config/profile.example.yml` if it mirrors them. | 15 min | P2 | codebase 3.1; scoring E.1 |
| C2 | Dead config keys (engine) | (a) `location_preferences.hybrid_anywhere_with_nyc_anchor` — no code path, no city/region combo maps to it (scoring E.1). (b) `anti_signals.glassdoor_below_3_5: -15` — code declares `patterns: []`; loop at `scoring-layer.mjs:333` skips empty-pattern entries. The -15 magnitude is loaded and dropped. (c) `soft_preferences.diverse_leadership: +2` — patterns are real but match no JD in the 1,090-record corpus. (d) `anti_signals.five_plus_rounds_in_18_months` — code-active, 0 emissions in corpus. (e) `hard_nos.company_signals` — substring-matches concept tags like `"layoffs announced 30d"` that no JD contains (scoring D.5). | All five give the false impression the engine considers them. They confuse anyone reading the config to understand what scoring actually does. Two of them (c, d) have real code paths and might fire someday — judgment call to keep or drop. Two (a, b) are dead by construction — definitely drop. One (e) needs an external lookup that doesn't exist. | Delete (a), (b), and the dead branch in `scoring-layer.mjs:333` that the empty-pattern check creates. For (c), (d), (e): mark with `# unused-as-of-2026-05-18` comments and a TODO to either implement the data source or drop. Conservative — don't delete signals that *could* fire if a JD changed; do delete signals that *cannot* fire by construction. | 1–2h | P1 | scoring E.1, D.5 |
| C3 | Dead config keys (archetypes) | `archetypes[].required_signals[]`, `archetypes[].company_filter.{require_b2b_saas, exclude_industries, require_ai_native_signals}`, `low_match` in `title_signals` (read by classifier, NOT by scoring-layer). | Same as C2 — declared but never consulted in scoring. `company_filter.*` suggests companies are pre-filtered by archetype; they aren't. | Delete `required_signals` and `company_filter.*` if grep confirms zero readers. For `low_match`: either wire into scoring layer as a third tier, or document that classifier-only and remove from scoring config schema. | 2h | P1 | scoring E.2 |
| C4 | Orphaned scripts (11 files) | `scripts/backfill-adjusted-scores.mjs`, `backfill-analytics-from-state.mjs`, `backfill-archetypes.mjs`, `backfill-jd-quality.mjs`, `backfill-locations.mjs`, `check-location-reclassification.mjs`, `migrate-seen-urls.mjs`, `prune-stale.mjs`, `rescan-locations.mjs`, `review-promotions.mjs`, `sync-score-feedback.mjs`. Not in `package.json` or docs. (Note: `sync-score-feedback.mjs` is **actively used** in scoring flow — has no package.json entry but writes `score-overrides.json`.) | Some are dead (one-time migrations), some are active but undiscoverable. Confuses new readers. The active scripts have no test coverage. Most importantly: `backfill-adjusted-scores.mjs` is used by Step 4 of this session brief — it must NOT be moved or renamed during this PR. | Triage: active scripts → add to `package.json` scripts section with a one-line description. One-time migrations → move to `scripts/archive/` with a README explaining when each ran. **Hold `backfill-adjusted-scores.mjs` as active** (gets used for any future re-score). | 1–2h | P2 | codebase 3.2 |
| C5 | `analyze-patterns.mjs` missing from `package.json` | Referenced in CLAUDE.md and `modes/patterns.md` but absent from scripts section. | Discoverability gap; users following docs hit "command not found." | Add `"patterns": "node analyze-patterns.mjs"` entry to `package.json`. | 5 min | P2 | codebase 3.3 |

### Category D — Test coverage gaps

| # | Item | What | Why it's debt | Fix shape | Effort | Risk | Source |
|---|---|---|---|---|---|---|---|
| D1 | Dashboard data pipeline zero tests | `getRoles()`, `computeScore()`, `parseScanReport()`, `parseApplications()`, `explainScore()`, `cleanCompany()`, `mapStatus()`, `readJsonSafe()`, `isJunkUrl()`, `isJunkTitle()`, `isFalsePositiveTitle()` — all untested. `open_roles_count` fallback to 0 also untested. | Entry point for every dashboard surface. Any change risks silent breakage. Refactors (B-series, A-series) are scary without this. | Branch coverage on each listed function including fallback paths. No production code touched. Acceptance: existing tests pass; new coverage demonstrably reaches the listed paths. **This is Step 2 of the session brief — being executed.** | 4–6h | **P0** | codebase 5.1; codebase Top-5 #1 |
| D2 | Untested fallback paths (subset of D1) | Score priority fallback (`data.ts:301`), pre-enrichment cap (`data.ts:312-315`), stale exclusion list (`data.ts:348`), source fallback chain (`data.ts:365`), `open_roles_count` zero-default (`signals-client.tsx:30`). | Each is a path the engine relies on; none has an assertion. The hardcoded `["Interview","Applied","Offer"]` stale list silently breaks if a new canonical status lands. | Folded into D1 — these are call sites within the same functions. | Folded into D1 | P0 | codebase 5.2 |
| D3 | Pipeline-integrity tools untested | `verify-pipeline.mjs`, `normalize-statuses.mjs`, `merge-tracker.mjs` have no automated tests. `CANONICAL_STATUSES` and `ALIASES` mappings can change without anything catching regressions. | These are the tools that keep `applications.md` integrity — silent regressions there cascade. | Snapshot-style tests for each. Fixture for the `applications.md` table; assertions on `CANONICAL_STATUSES` membership and `ALIASES` round-trip. | 2–3h | P1 | codebase 5.3 |

### Category E — Scoring math changes (**OUT OF CLEANUP SCOPE** — own decision after Prompt 2 reviewed)

Listed for inventory completeness; no PRs proposed here.

| # | Item | Source |
|---|---|---|
| E1 | California `"ca"` = Canada bug. ~50-80 records affected. **Being executed in Step 3 of this session brief — `fix/california-is-canada` branch, dry-run impact in Step 4.** This belongs to scoring math, but is already authorized by the brief; PRs #2/#3 below reference it. | scoring P0-1; user known #1 |
| E2 | `global_disqualifiers.location` is unread (`archetypes.yaml:158-164`). Nick's "fully on-site SF/LA/Seattle/Austin/Chicago" deal-breaker lives here but never fires. | scoring P0-2 |
| E3 | Dashboard reads `enrichment.fit_score` not `score_adjusted`. The G4 layer is invisible to most surfaces. | scoring P0-3 |
| E4 | Floor-clamp not observable. 425 records have `score_adjusted=0, score_disqualified=false`; can't distinguish "clamped" from "rejected." | scoring P1-1 |
| E5 | Trust-gate 10/10 ceiling cap (Anaconda smell). Records with `comp:below_floor_suppressed` can hit perfect score. | scoring P1-2; rescore Phase 1.5 |
| E6 | Web3 boost magnitudes diverge (classifier 60/20/10 vs scoring 35/12/6). Structural extraction is B3 above; the *decision* whether to unify magnitudes is math. | scoring P1-3 |
| E7 | Scoring paths reconcile — score-overrides.json uses eval×2 vs scan-jobs.mjs +2/min(4) (the Phase 11 TODO at `dashboard-web/lib/data.ts:321`). | codebase 7.1 |

### Category F — Open QA issues (NOT cleanup — feature/UX bugs, tracked separately)

Listed for inventory completeness. ISSUE-003 / 004 / 006–015 from `docs/qa-reports/2026-05-17-gstack-feat-polish-1.md`. These should land via separate work items, not this cleanup track.

---

## 2. PR sequence

Ordered by dependency, then ROI. PRs #1 and #2 are already in-flight as Steps 2 and 3 of this session brief; #3 is the natural follow-up to PR #2 once Step 4's impact doc is reviewed.

---

### PR #1 — test(dashboard): add data pipeline coverage

**Branch:** `test/dashboard-data-pipeline-coverage` (in-flight, Step 2 of session)
**Closes:** codebase 5.1 (D1), codebase 5.2 (D2)
**Touches:** `dashboard-web/lib/data.test.ts` (new); `dashboard-web/lib/signals-client.test.tsx` (extend) — production code NOT modified
**Acceptance:**
- Branch coverage on `getRoles`, `computeScore`, `parseScanReport`, `parseApplications`, `explainScore`, `cleanCompany`, `mapStatus`, `readJsonSafe`, and the `open_roles_count` fallback path.
- Existing tests still pass.
- No file under `dashboard-web/lib/data.ts` is modified.
- If a function is untestable without a refactor, the PR description names which one and why; refactor lands in a separate PR.
**Effort:** 4–6h
**Risk:** P0 — every later PR (#4, #5, #10, #12) needs this as a safety net.
**Dependencies:** none.

---

### PR #2 — fix(scoring): California `"ca"` is no longer treated as Canada

**Branch:** `fix/california-is-canada` (in-flight, Step 3 of session)
**Closes:** scoring P0-1 (E1); resolves the named drift records (OpenAI 9.3→0, Insight Partners, Skydio, Databricks, etc.) once PR #3 re-scores corpus
**Touches:** `scripts/lib/scoring-layer.mjs` (the `NON_US_CODES`/`isUS` definitions around lines 199-213); `scripts/lib/scoring-layer.test.mjs` (new tests for CA, ca, California, NY, Canada cities `toronto`/`montreal`, `Ontario`, `BC`)
**Acceptance:**
- Tests fail before fix, pass after.
- Existing tests still pass.
- Lint clean.
- Dashboard build clean.
- **No corpus re-score in this PR** — `data/enrichments.json` untouched. The re-score is PR #3, gated on impact-doc review.
**Effort:** 2–3h
**Risk:** **P0** — math is wrong on ~50-80 records; without this, Nick is making apply decisions on incorrect scores.
**Dependencies:** none (isolated to scoring-layer + tests).

---

### PR #3 — fix(data): re-score corpus after California fix

**Branch:** `fix/california-rescore-corpus` (or piggyback on PR #2 if Nick prefers — separated here to keep "code fix" and "data migration" as distinct review surfaces)
**Closes:** the 12-drift backlog (rescore doc); specifically the named records OpenAI Product Engineer, Introhive, Enable, Databricks, Built In Boston, Paytm, Gumloop, Skydio, Talos (x2), Insight Partners — re-scored against fixed `isUS`
**Touches:** `data/enrichments.json` (regenerated via `scripts/backfill-adjusted-scores.mjs` against the PR-#2 code)
**Acceptance:**
- Dry-run impact doc (`docs/audits/2026-05-18-california-fix-impact.md`) reviewed and approved by Nick.
- Live `backfill-adjusted-scores.mjs` run produces the same deltas as the dry-run for the 8 named records (spot-check).
- `data/enrichments.json` diff inspected before commit — no records lose `archetype_primary` or `comp_source` fields as a side effect.
- Tracker (`data/applications.md`) integrity passes `node verify-pipeline.mjs`.
**Effort:** 30 min (once dry-run review is in)
**Risk:** **P0** — without this, the fix ships but the corpus stays bad and the dashboard keeps showing the drift scores.
**Dependencies:** PR #2 merged + Step 4 impact doc reviewed by Nick.

---

### PR #4 — refactor(config): reconcile comp-floor to single source of truth

**Branch:** `refactor/comp-floor-single-source`
**Closes:** codebase 4.1 (partial — the 4 highest-leverage copies), codebase 4.6, scoring E.3 "two-floor problem", user known #2 (verified as four-floor)
**Touches:**
- Single source: `config/user-context.yaml:compensation.floor_usd` (unchanged at 200000 — Phase 2 will change the *value*; this PR is only about the *source*)
- Remove: `config/archetypes.yaml:165` `global_disqualifiers.comp_below` (validator-only — grep-verified zero scoring readers)
- Template: `modes/_profile.md:76,84,168` — replace `"$190K"` with a `{{floor_usd}}` placeholder; `scripts/generate-briefing.mjs` substitutes at prompt-assembly time. (If templating is rejected: keep the literal but add a sync comment + a test that asserts mode file's number equals `floor_usd`.)
- Build dynamically: `scripts/generate-briefing.mjs:119` and `dashboard-web/app/api/chat/route.ts:87` fallback strings now construct the `"$XXX+"` from the config value.
- Read from config: `autoapply/chrome-extension/popup/popup.js:36` `salary_floor_usd` default; `autoapply/tests/test_apply_cli.py:43` and `personalab/tests/fixtures/valid_persona.yaml:10` test fixtures (read from config via dynamic import, or fixture is generated).
- Update: `scripts/lib/scoring-layer.test.mjs:109,180` "$190K floor" verdict text → match whatever single value is canonical (likely "$200K" to keep current engine behavior).
**Acceptance:**
- Grep for hardcoded `190000`, `200000`, `"$190K"`, `"$200K+"` finds zero matches outside `config/user-context.yaml` and generated test fixtures.
- A new test (`config/test_comp_floor_consistency.test.mjs` or similar) asserts: (a) `modes/_profile.md` substituted output contains the config value, (b) briefing fallback string contains the config value, (c) chat API fallback string contains the config value.
- All existing tests pass after fixture regeneration.
- `archetypes.yaml.global_disqualifiers.comp_below` deletion does not break `archetype-config.mjs` validation (probably needs schema update at `archetype-config.mjs:113-115`).
**Effort:** 4–6h
**Risk:** **P0** — Decision F in the handoff names Comp Phase 2 as the next major scoring decision. Without this PR, Phase 2's floor change requires touching 4+ files and risks missing one.
**Dependencies:** PR #1 (need data-pipeline tests so any fallback-string regression is caught). Otherwise independent.

---

### PR #5 — refactor(shared): extract FUZZY_SUFFIXES / PRIMARY_ARCHETYPES / hasRealComp to shared modules

**Branch:** `refactor/shared-cross-runtime-constants`
**Closes:** A1, A3, A4, A5 (the cross-runtime duplication cluster) + the stale-comment fix from A3 (subsumes the 5-min stale-comment patch)
**Touches:**
- New: `config/role-matching.json` (or `config/shared-constants.json`) — declares `fuzzy_suffixes`, `primary_archetypes`, optional helpers like `empty_comp_values`.
- New: `scripts/lib/shared-constants.mjs` — `JSON.parse(fs.readFileSync(...))` of the JSON; re-exports as named constants. Optional: also re-exports `hasRealComp()` helper.
- New: `dashboard-web/lib/shared-constants.ts` — JSON import + re-export with TS types.
- Modify: `scripts/lib/company-aggregator.mjs:30,39`, `scripts/lib/company-archetype-matcher.mjs:18,21`, `dashboard-web/lib/role-matching.ts:36`, `scripts/lib/analytics-rollup.mjs:441-464`, `dashboard-web/lib/source-detail.ts:113-133` → all import from the shared module.
- Update existing sync comments to point at the shared module (or remove if no longer needed).
- Test pin at `dashboard-web/lib/canonical-counts-integration.test.ts:117-129` keeps its assertion but reads from the shared module loader (single source of truth now enforced by the loader, the test pin guards the *content*).
**Acceptance:**
- Grep for `FUZZY_SUFFIXES = [`, `PRIMARY_ARCHETYPES = `, `COMPANY_SUFFIXES = `, `hasRealComp = ` returns one declaration per name.
- All existing tests pass.
- A new test (`scripts/lib/shared-constants.test.mjs`) asserts the JSON loads and the exports match a fixture.
- A new cross-runtime test asserts `scripts/lib/shared-constants.mjs` exports the same values as `dashboard-web/lib/shared-constants.ts` (snapshot or fixture-driven).
**Effort:** 4–6h
**Risk:** P1 — no current drift; sync comments + test pin are doing their job. But the pattern caps at 3 sites — won't scale to 4 or 5. ROI compounds for every future shared constant.
**Dependencies:** PR #1 (tests as safety net for any subtle behavior change during the import migration).

---

### PR #6 — refactor(matcher): apply defensive fallback to candidateKeys (or subsume into PR #5)

**Branch:** `fix/matcher-candidate-keys-fallback`
**Closes:** A2 (real silent-drift bug in `company-archetype-matcher.mjs:28-36`)
**Touches:** `scripts/lib/company-archetype-matcher.mjs:28-36`; new test.
**Acceptance:** matcher's `candidateKeys()` produces the same output as the aggregator's and the dashboard's for a fixture of raw (un-normalized) inputs. Test asserts equality across all 3 implementations (or against the PR #5 shared module if it landed first).
**Effort:** 1h (or 0 if PR #5 absorbs the function)
**Risk:** P1 — real silent bug, but hasn't surfaced because the matcher is only called from contexts that pre-normalize.
**Dependencies:** if PR #5 lands first, this is absorbed (delete the PR). If not, it's a standalone 1h fix.

---

### PR #7 — chore(docs): fix stale cross-reference + PRIMARY_ARCHETYPES sync comment (only if PR #5 deferred)

**Branch:** `chore/sync-comment-fixes`
**Closes:** codebase 7.5 + A4 sync-comment half
**Touches:** `scripts/lib/analytics-rollup.mjs:441` (point to `source-detail.ts` not `source-health.ts`); `scripts/lib/company-aggregator.mjs:30` and `company-archetype-matcher.mjs:18` (add cross-reference sync comment).
**Acceptance:** comments accurate; grep confirms each cross-reference resolves to the named file.
**Effort:** 15 min
**Risk:** P2 — purely documentation; prevents wasted debugging.
**Dependencies:** delete this PR if PR #5 lands first (subsumed).

---

### PR #8 — chore(config): delete dead config keys

**Branch:** `chore/delete-dead-config`
**Closes:** C1, C2 (a) (b), C3 — the dead-by-construction keys
**Touches:**
- `config/user-context.yaml`: remove `identity.{home_city,home_state,home_country}`, `location_preferences.hybrid_anywhere_with_nyc_anchor`, `anti_signals.glassdoor_below_3_5` block.
- `scripts/lib/scoring-layer.mjs`: remove the dead branch around line 333 that the empty-`patterns` check creates; remove the `glassdoor_below_3_5` pattern row.
- `config/archetypes.yaml`: remove `archetypes[].required_signals`, `archetypes[].company_filter.*` (verify with grep first).
- Also: drop `low_match` references from scoring-layer call sites if confirmed unused there (note: classifier reads `low_match`, so keep that side).
- Update `config/profile.example.yml` to mirror.
- DO NOT delete: `soft_preferences.diverse_leadership`, `anti_signals.five_plus_rounds_in_18_months`, `hard_nos.company_signals` (these have code paths and could fire someday — mark with `# unused-as-of-2026-05-18` comment instead). DO NOT touch `global_disqualifiers.comp_below` (handled by PR #4) or `global_disqualifiers.location` (math change — deferred).
**Acceptance:**
- Grep confirms zero readers for each deleted key.
- All existing tests pass.
- `archetype-config.mjs` validator schema updates remove deleted keys (otherwise validation errors).
- Behavior on the corpus is unchanged (re-run scoring on 3-5 representative roles; deltas should be 0).
**Effort:** 2h
**Risk:** P1 — config-only, no behavior change, but confusion-removal compounds.
**Dependencies:** none.

---

### PR #9 — chore(scripts): archive orphaned scripts + add `analyze-patterns` to package.json

**Branch:** `chore/archive-orphaned-scripts`
**Closes:** codebase 3.2 (C4), 3.3 (C5)
**Touches:**
- `scripts/archive/` (new directory).
- Move: `backfill-analytics-from-state.mjs`, `backfill-archetypes.mjs`, `backfill-jd-quality.mjs`, `backfill-locations.mjs`, `check-location-reclassification.mjs`, `migrate-seen-urls.mjs`, `prune-stale.mjs`, `rescan-locations.mjs`, `review-promotions.mjs` to `scripts/archive/`.
- Add `scripts/archive/README.md` documenting when each ran and what `data/*` file it last produced.
- **Hold in place** (do NOT move): `scripts/backfill-adjusted-scores.mjs` (actively used for re-scores), `scripts/sync-score-feedback.mjs` (actively writes `score-overrides.json` — add a `package.json` entry: `"sync-score-feedback": "node scripts/sync-score-feedback.mjs"`).
- Add `"patterns": "node analyze-patterns.mjs"` to `package.json`.
**Acceptance:**
- `npm run patterns` works.
- `npm run sync-score-feedback` works (or whatever name fits the script convention).
- `scripts/archive/README.md` lists every moved script with a 1-line "what it did + when last run."
- CLAUDE.md `Main Files` table updated if a referenced script moved.
**Effort:** 1–2h
**Risk:** P2 — purely organizational. Make sure nothing in CI or cron references a moved script before merging.
**Dependencies:** none.

---

### PR #10 — refactor(constants): centralize fit-score thresholds + time thresholds

**Branch:** `refactor/centralize-thresholds`
**Closes:** B2, B5 (combined — both are "code values that should be named constants in one place")
**Touches:**
- New: `scripts/lib/thresholds.mjs` — exports `BRIEFING_APPLY_THRESHOLD = 6`, `BRIEFING_MISSED_THRESHOLD = 7`, `BRIEFING_RECALIBRATION_RANGE = {min: 4, max: 6}`, `SCAN_CONFIDENCE_THRESHOLD = 4.0`, `FEEDBACK_CONFLICT_THRESHOLD = 4.0`, `CHAT_PRUNING_DAYS = 30`, `STALE_APPLICATION_DAYS = 3`.
- Modify call sites: `scripts/generate-briefing.mjs:184,206,215,226,362,199`; `scripts/scan-jobs.mjs:575`; `scripts/sync-score-feedback.mjs:142,149`.
- `MIN_FIT_SCORE_FOR_PROMOTION` in `promote-company.mjs:48` re-exported from `thresholds.mjs` for consistency.
**Acceptance:**
- Grep for hardcoded `>= 6`, `>= 7`, `>= 4.0`, `>= 4 && <= 6`, `30 * 24 * 60 * 60`, etc. in the listed files finds zero matches (replaced by imported constants).
- A new test (`scripts/lib/thresholds.test.mjs`) snapshots the constants and asserts each call site uses the named export.
- All existing tests pass.
**Effort:** 2h
**Risk:** P1 — prevents subtle drift the next time someone tunes "the briefing threshold."
**Dependencies:** PR #1 (tests).

---

### PR #11 — chore(briefing): unify goal-fallback string

**Branch:** `chore/unify-goal-fallback`
**Closes:** B4
**Touches:**
- New: `scripts/lib/default-goal.mjs` exporting `getDefaultGoal({ floorUsd })` — builds the fallback string dynamically from the config value (composes with PR #4).
- Modify: `scripts/generate-briefing.mjs:119` and `dashboard-web/app/api/chat/route.ts:87` to call `getDefaultGoal(...)`.
**Acceptance:**
- Both call sites return the same string for the same `floor_usd`.
- Grep for the literal `"GTM Engineer / RevOps roles, NYC area or remote, $200K+ floor, Series B+ companies"` returns zero matches (now built dynamically).
- Tests for both fallback paths cover the dynamic build.
**Effort:** 30 min
**Risk:** P2 — low-effort, removes a fifth comp-floor copy.
**Dependencies:** PR #4 (composes with the floor source).

---

### PR #12 — refactor(scoring): move Web3 boosts + title-signal magnitudes to config (structural only)

**Branch:** `refactor/extract-scoring-magnitudes`
**Closes:** B3 (the structural part — moving magnitudes from source code to config). Does NOT touch the math (math reconciliation between classifier 60/20/10 and scoring 35/12/6 is deferred to scoring-math decision; this PR just makes both readable from one place).
**Touches:**
- `config/archetypes.yaml`: add `institutional_companies_boost.classifier_weights: {stablecoin_tier: 60, tier_1: 20, tier_2: 10}` and `.scoring_weights: {stablecoin_tier: 35, tier_1: 12, tier_2: 6}`. Add `title_signals.high_match_weight: 8`, `.medium_match_weight: 4` (or per-archetype if Nick wants tunability).
- `scripts/lib/archetype-classifier.mjs:154,157,160`: read classifier_weights from config.
- `scripts/lib/scoring-layer.mjs:271-279`: read scoring_weights + title bonuses from config.
- Schema update in `archetype-config.mjs` to validate new fields.
**Acceptance:**
- Re-run scoring on 5 representative roles before + after; deltas are 0 (structural-only).
- New tests assert magnitudes are read from config (mock config swap demonstrates).
- All existing tests pass.
**Effort:** 2–3h
**Risk:** P1 — magnitudes-in-config is a prerequisite for any future math reconciliation (E6). This PR doesn't change behavior, but unlocks the future change.
**Dependencies:** PR #1 (tests).

---

### PR #13 — test(pipeline): add coverage for integrity tools

**Branch:** `test/pipeline-integrity-tools`
**Closes:** D3
**Touches:** `verify-pipeline.test.mjs`, `normalize-statuses.test.mjs`, `merge-tracker.test.mjs` (all new). Production code untouched.
**Acceptance:**
- Snapshot tests for `applications.md` fixtures through each tool.
- `CANONICAL_STATUSES` and `ALIASES` round-trip tests (any new status must be reflected in both).
- Tests fail if the canonical-status set drifts from `templates/states.yml`.
**Effort:** 2–3h
**Risk:** P2 — no active bug; catches future regressions in pipeline-integrity tooling.
**Dependencies:** none.

---

## 3. Estimated total effort

| PR | Effort (focused hours) |
|---|---|
| #1 — Dashboard pipeline tests | 4–6 |
| #2 — California fix | 2–3 |
| #3 — Re-score corpus | 0.5 |
| #4 — Comp-floor single source | 4–6 |
| #5 — Shared-constants extraction | 4–6 |
| #6 — candidateKeys fallback (likely subsumed) | 0–1 |
| #7 — Sync-comment fixes (likely subsumed) | 0–0.25 |
| #8 — Delete dead config | 2 |
| #9 — Archive orphaned scripts | 1–2 |
| #10 — Centralize thresholds | 2 |
| #11 — Unify goal fallback | 0.5 |
| #12 — Extract scoring magnitudes | 2–3 |
| #13 — Pipeline-integrity tests | 2–3 |
| **Total** | **24–35 focused hours** |

**Calendar estimate (realistic with review cycles, context switching, and one-PR-at-a-time landing):** 3–5 weeks of part-time work. Reasoning: each PR has a 1-2 day review window, P0s need careful inspection, refactor PRs benefit from a day's gap so the reviewer can re-look fresh. Two PRs per week is a realistic pace at this size.

**Aggressive parallel calendar:** if Nick pushes two reviewers and parallelizes the independent PRs (#8, #9, #11, #13), the critical path collapses to ~2 weeks. The dependency graph below shows the parallelization surface.

```
PR #1 ──┬── PR #4 ──┬── PR #11
        ├── PR #5 ──┬── PR #6 (subsumed)
        │           └── PR #7 (subsumed)
        ├── PR #10
        └── PR #12

PR #2 ── PR #3

PR #8  (independent)
PR #9  (independent)
PR #13 (independent)
```

Critical path: #1 → #5 → #6 (if not subsumed). Aggressive estimate 8–12 calendar days; realistic 18–25.

---

## 4. Risk assessment — what could break if these don't get cleaned up before productize

**HIGH (must land before productize):**
- **PR #2/#3 not landed:** Nick makes apply decisions on wrong scores for ~50-80 California roles. Real GTM-engineering roles at OpenAI, Databricks, Skydio currently show as 0/10 (drift) or get filtered out of /pipeline. The same bug will repeat on every future location backfill.
- **PR #4 not landed:** Phase 2 comp work touches 4+ files. Risk of one being missed → engine + Claude prompt disagree on floor (already happening: $200K vs $190K). Productizing pricing tiers requires this to be one number.
- **PR #1 not landed:** any subsequent refactor (#5, #10, #12) ships without a safety net. Silent breakage in `getRoles()` would not surface until a user reports a missing role.

**MEDIUM (should land, but won't block productize on day 1):**
- **PR #5 not landed:** the 3-way sync comment + test pin pattern is functional. No current drift. But adding a 4th surface (e.g., a backend service that needs the same suffix list) doubles risk; the pattern doesn't scale.
- **PR #8 not landed:** dead config confuses new readers. If Nick adds a contractor or onboards a second user, they'll waste an afternoon assuming Glassdoor scoring exists.
- **PR #10 not landed:** tuning the briefing threshold (a routine product knob) requires a sweep. Small bug surface every time.
- **PR #12 not landed:** any future scoring-math decision (especially the Web3-magnitude reconciliation in E6) is blocked on the magnitudes being in config first.

**LOW (defer freely):**
- **PRs #9, #11, #13:** organizational + minor cleanup. No bug surface.

**External risk not addressed by this plan:** the scoring math changes in Category E (especially E2 `global_disqualifiers.location` and E3 dashboard reading `score_adjusted`) are the largest *behavioral* gaps in the engine. Cleanup alone doesn't fix them. They need their own decision after Nick reads the scoring audit.

---

## 5. What to land FIRST — next-session recommendation

**Land in this order:**

1. **PR #1 — dashboard pipeline tests** *(in flight as Step 2; merge as soon as Nick reviews)*. This is the safety net for everything that follows. Without it, every refactor is scary.

2. **PR #2 — California fix** *(in flight as Step 3; merge as soon as Nick reviews and Step 4's impact doc is approved)*. Fixes wrong math on 50-80 records. The drift records named in the rescore doc (OpenAI, Introhive, Enable, Databricks, etc.) clear on PR #3.

3. **PR #3 — re-score corpus** *(gated on Step 4 review)*. Without this, PR #2 ships code but data stays bad.

4. **PR #4 — comp-floor single source**. Decision F in the handoff names this as a Phase 2 prerequisite. Land before any Phase 2 work touches the floor.

After those four land, the rest can be sequenced flexibly — but **PR #5 (shared-constants)** should come next because PRs #6, #7, #10, #12 all benefit from the shared-module pattern once it exists.

**Don't start in this session beyond what's already authorized (Steps 1–4 of the brief).** This plan is the deliverable; the actual PR #4+ work waits for Nick's review.

---

## Cross-references

- `docs/audits/2026-05-18-codebase-review.md` — full source of Categories A, B, C, D items.
- `docs/audits/2026-05-18-scoring-engine-audit.md` — full source of Categories B, C, E items; Phase E.3 names the comp-floor duplication.
- `docs/audits/2026-05-18-comp-trust-gate-rescore.md` — the 12 drift records named in PR #3 acceptance criteria.
- `docs/qa-reports/2026-05-17-gstack-feat-polish-1.md` — Category F open ISSUEs (tracked separately, not in this plan).
- `docs/COORDINATED_MERGE_PLAN.md` — referenced for multi-branch push coordination if any of these PRs need to merge alongside others.
- `docs/PHASE_11_TODO.md` — contains the "reconcile scoring paths" item (codebase 7.1 / scoring E7) deferred to scoring-math decision.
