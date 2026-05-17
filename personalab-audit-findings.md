# PersonaLab audit findings — feat/personalab-improvements

_Generated 2026-05-17. Worktree: `nick-career-ops-personalab`. Baseline: 109 passed, 2 skipped._

The audit covers `personalab/core/{runner,analyzer,synthesizer,persona_schema,behavior}.py`, all three schema YAMLs, the live `qa/app.yaml`, and an empirical pass over 3 of 6 reports + the 10-pattern synthesis spec produced this morning (`qa/synthesis/polish-spec-draft-20260517.md`).

Severity legend for findings: **H** = produces false positives or false negatives in shipped reports. **M** = measurement noise that can mislead. **L** = polish on the framework itself.

---

## runner.py findings

| # | Sev | Finding | Evidence | Why it matters |
|---|-----|---------|----------|----------------|
| R1 | **H** | `_visible_action_names` swallows all selector errors (`except Exception: pass`) and returns `[]`. The runner cannot distinguish "selector matched 0 elements" (missing affordance) from "selector failed to evaluate" (broken selector or wrong syntax) from "page hadn't hydrated yet." | `runner.py:564-572` | Single root cause of the C6 false-positive cascade. Every downstream consumer treats `visible_action_names=[]` as ground truth about the page. |
| R2 | **H** | Capture happens at `wait_until="domcontentloaded"` (line 241) and reads `body.innerText` + visible-action selectors immediately after (lines 262-267). For SPA routes that fetch data after first paint, the runner measures the shell, not the hydrated content. | `runner.py:241,263-267`; empirical: mid-revops `/today` rendered in 1962ms with `body_text_length=0` while `visible_action_names=['run_scan']` — internally inconsistent. | False `data_density` (zero text) and false `missing_action` (zero affordances) on every fast-loading dynamic route. |
| R3 | **H** | No distinction in the session log between "selector matched 0" and "selector matched but click failed" and "page didn't load." All surface as some flavour of error/missing-affordance reasoning event with a `repr(exc)` string — no structured `error_type` field. | `runner.py:486-493,564-572`; action failures all serialize as `"Action failed: TimeoutError(…)"` strings. | Analyzer can't tier severity by failure mode; downstream taxonomy collapses three distinct conditions into one. |
| R4 | **M** | `page_state.console_errors` is `list(self.console_errors)` — the *cumulative* console-error list at capture time. A duplicate-key warning on `/today` shows up in the nav events for `/pipeline`, `/companies`, `/signals`, and `/context`. | `runner.py:257`; empirical: fde-from-palantir `/companies/[slug]` has 21 console errors, `/signals` 21, `/context` 24 — all the same 21 plus accumulating. | Analyzer attributes errors to whichever route was sampled, not where they originated. |
| R5 | **M** | `expected_load_time_ms` budget is read per-route (✅) but only emitted in the human-readable `reasoning` string — there is no structured `budget_ms` field on the nav event. | `runner.py:272,280-284` | Analyzer must parse the reasoning string to know the budget. Friction-of-degree (`render_time / budget`) can't be computed reliably downstream. |
| R6 | **M** | Detail-route traversal caps at one level deep and silently no-ops for unmatched routes. The session log records *no event* when `/companies/[slug]` was the parent-action's destination but didn't match the pattern — the failure is invisible. | `runner.py:373-440` | A misconfigured detail pattern leaves zero footprint in the JSONL — analyzer never knows traversal was attempted. |
| R7 | **M** | The persona `meta_attitude` and `rejection_threshold` are referenced in reasoning text only (lines 197, 480-484) but never drive any behavioral choice. The runner does not act differently for a "skeptical / tired" persona than a "calm / curious" one. | `runner.py:197,480-484`; `behavior.py` has no `rejection_threshold` reference at all. | Cross-persona "diverse opinions" are largely illusory — the runner produces ~identical interaction traces per persona; persona variance lives only in the analyzer's interpretation. |
| R8 | **M** | `detail_dwell_ms` honored by the runner is `min(declared, 1500)` (line 359) but the analyzer's prompt sees the *declared* value (e.g., 80000ms) via the persona context. | `runner.py:359` vs `analyzer.py:185` | Analyzer can reason "persona dwelled 80s and bounced" when actually they only got 1.5s. |
| R9 | **L** | Navigation success gate (`status not in (None, 200, 304)`, line 286) collapses 4xx/5xx + 204/redirect outcomes into the same "broken" bucket without separating them in page_state. | `runner.py:286` | 404 vs 500 vs redirect-to-login look identical downstream. |
| R10 | **L** | `_take_action` doesn't capture post-click state. After `expand_role_row` fires there's no fresh `body_text_length` or `visible_action_names` reading. | `runner.py:442-493` | Analyzer can't verify whether the action actually changed the page. |
| R11 | **L** | `self.console_errors` accumulates across `run()` calls if a PersonaRunner is reused (no reset). Currently safe because the orchestrator builds a fresh runner per persona, but latent. | `runner.py:156` | Future refactor footgun. |
| R12 | **L** | Click delay (`click_delay_ms`) is honored but not logged in the action event — replay/auditability gap. | `runner.py:342` | Timing-sensitive scenarios can't be replayed deterministically. |

---

## analyzer.py findings

| # | Sev | Finding | Evidence | Why it matters |
|---|-----|---------|----------|----------------|
| A1 | **H** | The taxonomy has no slot for "we couldn't tell whether the page lacks the affordance or PersonaLab lacks the selector." The known C6 bug is *structural in the schema*: every measurement failure is forced into `missing_action` / `empty_state` / `data_density`. | `analyzer.py:54-60`; KNOWN_FRICTION_TYPES in `persona_schema.py:33-42` has 8 entries, none for detection uncertainty. | This is the root of the false-positive cascade. The analyzer is doing what its taxonomy permits. |
| A2 | **H** | `_build_user_message` strips `page_state` to a fixed subset (lines 211-222), dropping `capture_error` and the action `selector` from event records. The analyzer can't see *which selector* failed, and can't see whether evaluation errored at all. | `analyzer.py:211-222` (kept fields list) — `capture_error` from `runner.py:269` is silently discarded. | Analyzer has fewer signals than the runner captured. |
| A3 | **H** | System prompt instruction "Prefer 3-7 friction events over a dump of 20" (line 155) imposes a **floor**, not just a ceiling. On clean sessions the LLM is incentivized to pad findings to hit 3+. | `analyzer.py:155` | Counter-incentive to honesty: an easy session can't return 0 events without contradicting instructions. |
| A4 | **H** | The Pydantic `FrictionReport` has no `confidence` or `evidence_event_ts` field. The prompt asks the model to "anchor every friction_event to a concrete event" but the schema has no place to record the anchor. | `analyzer.py:50-70` | Humans verifying reports (e.g. in this audit) have to fuzzy-match prose descriptions to JSONL events. Findings cannot be tied to specific session lines. |
| A5 | **M** | `severity` and `signal_type` are free-form `str` — no enum validation. The model could return `severity="catastrophic"` or `signal_type="ux_friction"` and Pydantic would accept it. `signal_type` is *not* runtime-validated against `app_config.friction_signals`. | `analyzer.py:53-54,73,82,90`; render in `analyzer.py:242` lowercases anything. | Drift between model output and the declared app taxonomy goes undetected. |
| A6 | **M** | Pydantic field descriptions hardcode the 8-type taxonomy (lines 56-58). If `app.yaml` adds a 9th type, the system prompt is correct (`_build_friction_taxonomy` iterates), but the Pydantic doc-string still claims the old 8. | `analyzer.py:56-60` vs `analyzer.py:145-147` | Divergence risk when extending the taxonomy. |
| A7 | **M** | Per-persona "weight by sensitivities" instruction (line 188-191) is qualitative — no rule like "bump severity one level for sensitive personas." Severity ends up nearly uniform across personas for the same observed event. | `analyzer.py:188-191`; empirical: all 6 personas reported `/context` as "high" `empty_state` despite varying `friction_sensitivities`. | "Cross-persona variance" is largely persona-blind — undermines a major value prop of multi-persona testing. |
| A8 | **M** | No retry on transient API failures; one `messages.parse` call per session. | `analyzer.py:381` | A single 529 fails the whole session and forces re-orchestration. |
| A9 | **L** | Events in `_build_user_message` have `None` values dropped (line 224). After dropping, the model loses the *positional* signal that `render_time_ms: None` means "this was a reasoning event, not a nav." | `analyzer.py:224` | Slight loss of structural cue; the model can still infer from `event_type`. |
| A10 | **L** | No `dry_run` mode on the analyzer itself. Useful for prompt-only validation. | `analyzer.py:371-411` | Minor; orchestrator probably has one. |

---

## synthesizer.py findings

| # | Sev | Finding | Evidence | Why it matters |
|---|-----|---------|----------|----------------|
| S1 | **H** | "Cap at ~10 patterns" (line 88-90) is the same padding-floor issue as A3. On a clean app the synth must produce 10 patterns or contradict the prompt. | `synthesizer.py:88-90,117` | Top-of-list ranking goes to weakest patterns when the real-issue count is < 10. |
| S2 | **H** | The synthesizer treats per-persona severity as ground truth and aggregates `severity_range` directly (line 56-58). But analyzer findings A7 show severity is persona-blind — so "5/6 personas high severity" amplifies a single underlying call by counting the analyzer's uniform output as independent agreement. | `synthesizer.py:56-58`; empirical: 6/6 personas marked `/context` high → top-ranked pattern. | Hallucination amplifier. The synthesizer can't tell that 6 personas "agreed" because the analyzer applied the same call 6 times. |
| S3 | **H** | No `confidence` field on `FrictionPattern` and no instruction to flag low-confidence patterns. A pattern built entirely on measurement-failure events (visible=[] when actually the page has 6 tabs) is presented with the same weight as one built on a real timeout. | `synthesizer.py:45-78` | Recommendations are not safe to act on without re-verification — and there's no marker for which ones need re-verification. |
| S4 | **M** | No instruction for handling cross-persona disagreement (3 say great, 3 say broken). | `synthesizer.py:113-129` | Defaults to whichever framing the LLM picks; small N → high variance. |
| S5 | **M** | `personas_affected` is compiled by the LLM with no dedup or normalization enforced. If the same root cause is filed under two different `signal_type` values by different personas (e.g. `missing_action` vs `data_density` on `/today`), the synth groups by signal_type and **undercounts** persona impact. | `synthesizer.py:59-61,215-217`; empirical: `/today` show up as both "missing_action" and "slow_load" with different persona sets. | Real cross-persona impact is split across rows. |
| S6 | **M** | No aggregation of `wins` across personas. If 5/6 personas loved the `/pipeline` row layout, that signal is lost. | `synthesizer.py:81-93` | Asymmetric output: friction is amplified, wins are dropped. |
| S7 | **M** | Effort estimate (`S/M/L`) is pure LLM guess. No grounding signal (file size, route complexity, dependency graph). | `synthesizer.py:71,124-125` | Effort estimates likely arbitrary; don't trust them for sequencing. |
| S8 | **M** | Persona-id parsing assumes `<id>-<YYYYMMDDTHHMMSSZ>.json` filename pattern with exactly one trailing timestamp component (line 173-177). Fragile across format changes. | `synthesizer.py:173-177` | A future refactor changing the timestamp slug breaks the synth silently. |
| S9 | **L** | No way to exclude a specific persona's report from synthesis (e.g., when their session was known-broken). | `synthesizer.py:314-326` | All-or-nothing — must manually delete files. |
| S10 | **L** | No filter for stale reports. Synth pulls latest-per-persona regardless of age. | `synthesizer.py:160-194` | Mixed-vintage reports get synthesized without warning. |

---

## Schema findings

| # | Sev | Finding | Evidence | Why it matters |
|---|-----|---------|----------|----------------|
| SCH1 | **H** | `KNOWN_FRICTION_TYPES` has no entry for `instrumentation_gap` (or equivalent) — the schema **prevents** the analyzer from filing a measurement-uncertainty event even if the prompt asked it to. | `persona_schema.py:33-42` | Hard-blocks the right fix. |
| SCH2 | **H** | The friction-type vocabulary is **duplicated in three places**: `persona_schema.KNOWN_FRICTION_TYPES`, `analyzer.FrictionEvent.signal_type` description, and `synthesizer.FrictionPattern.signal_type` description. Adding a type requires three edits and silently goes wrong if one is missed. | `persona_schema.py:33-42`, `analyzer.py:56-60`, `synthesizer.py:49-54` | Schema drift footgun. |
| SCH3 | **M** | Each action declares exactly one `selector` (string). No `selector_fallbacks: list[str]` and no `data_attribute: str` (for `data-action="run_scan"` style instrumentation that survives copy refactors). | `app-config.schema.yaml:30-34` and `qa/app.yaml:59-124` | Brittle CSS-based instrumentation is the proximate cause of C6. A `data-action`-attribute fallback would make instrumentation survive copy and structural refactors. |
| SCH4 | **M** | No route-level field for "wait for X before measuring" (e.g., `wait_for_selector: '[data-hydrated]'`, `wait_for_text_length: 200`). Runner uses fixed `domcontentloaded`. | `app-config.schema.yaml:23-28` | Forces a brittle global timing assumption. |
| SCH5 | **M** | No route-level `expected_friction_signals` declaration. App.yaml can't say "/context: persona should hit `missing_action` if profile editor is broken" so the analyzer can't compare actual to expected. | `app-config.schema.yaml:23-28` | Missed opportunity for grounded false-negative detection. |
| SCH6 | **L** | Scenario schema doesn't cross-check that `based_on` references an existing persona file. | `persona_schema.py:264-320` | Misspelled persona id fails late, not at load. |
| SCH7 | **L** | `KNOWN_CLICK_SPEEDS` includes `medium-fast` but no `slow-medium` — asymmetric enum. | `persona_schema.py:44` | Cosmetic. |

---

## Empirical audit

Sampled 3 reports × ~7 friction events each = 21 events. Verdicts traced to source JSONLs at `qa/runs/`.

### ai-ops-lead-early-stage (session `…T070805Z`)

| Finding | Verdict | Evidence |
|---------|---------|----------|
| HIGH `slow_load` `/pipeline` 10s timeout | **REAL** | session: render=10069ms, status=None, nav_error=True |
| HIGH `slow_load` `/today` 7244ms vs 2000ms | **REAL** | session: render=7244ms |
| HIGH `missing_action` `/today` `click_role_row` | **AMBIGUOUS — likely FP** | body_text_length=498 after 7.2s = hydration not complete; selector may match real content if measured later |
| MED `missing_action` `/signals` `open_signal_detail` | **AMBIGUOUS** | body_len=2242, plausible; selector `'a[href^="/signals/"], [data-signal-id]'` may or may not match app's signal list rendering |
| HIGH `missing_action` `/context` | **FALSE POSITIVE** (the C6 bug) | session: visible=[], body_len=1187. Reality: /context has 6 fully-built tabs. Selectors `'a:has-text("Profile")'` / `'a:has-text("Archetype")'` don't match. |
| MED `archetype_confusion` `/context` | **HALLUCINATED (compound on FP)** | Built on top of the empty-/context finding; no independent evidence. |
| MED `navigation` `/companies/[slug]` only back-button | **AMBIGUOUS (schema coverage)** | body_len=3643, but `app.yaml` only declares `back_to_companies` for this route. Runner never looked for roles or signals. |

### fde-from-palantir (session `…T070805Z`)

| Finding | Verdict | Evidence |
|---------|---------|----------|
| HIGH `slow_load` `/today` 7249ms | **REAL** | render=7249ms |
| HIGH `slow_load` `/pipeline` timeout | **REAL** | render=10048ms, nav_error=True |
| HIGH `missing_action` `/today` row click | **AMBIGUOUS — likely FP** | body_len=498 + 7.2s; same hydration issue |
| MED `missing_action` `/signals` | **FALSE POSITIVE** | session: body_text_length=**0**, status=200. Page didn't render content. Analyzer treated `visible=['filter_signals']` as ground truth about the surface. |
| HIGH `empty_state` `/context` body=0 visible=[] | **FALSE POSITIVE** | body_text_length=0 across multiple routes in this session → measurement issue. Reality: /context has 6 tabs. |
| MED `archetype_confusion` `/context` | **HALLUCINATED (compound)** | Same as ai-ops. |
| LOW `navigation` `/companies/[slug]` dead-end | **AMBIGUOUS (schema coverage)** | Same as ai-ops. |

### ambivalent-explorer (session `…T070840Z`)

| Finding | Verdict | Evidence |
|---------|---------|----------|
| HIGH `slow_load` `/pipeline` | **REAL** | render=10087ms |
| HIGH `missing_action` `/today` row | **AMBIGUOUS — likely FP** | Same /today hydration issue |
| HIGH `slow_load` `/today` | **REAL** | render=7210ms |
| MED `missing_action` `/signals` | **AMBIGUOUS** | Same as ai-ops |
| HIGH `empty_state` `/context` | **FALSE POSITIVE** (C6) | visible=[], body_len=1187 — same selector issue |
| MED `archetype_confusion` `/context` | **HALLUCINATED (compound)** | |
| LOW `navigation` `/companies/[slug]` | **AMBIGUOUS (schema coverage)** | |

### Per-event tally

| Verdict | Count | % of 21 |
|---------|-------|---------|
| REAL | 7 | 33% |
| FALSE POSITIVE (instrumentation/selector failure misread as friction) | 6 | 29% |
| HALLUCINATED (compound on a false positive) | 3 | 14% |
| AMBIGUOUS — schema coverage gap | 3 | 14% |
| AMBIGUOUS — hydration timing | 2 | 10% |

**Combined: ~43% of friction events are false positives or compound hallucinations.** The top-severity findings cluster on `/context` and `/today`, which is precisely where measurement is least reliable.

### Synthesis spec sampling (3 of 10 patterns)

| Pattern | Personas affected | Verdict |
|---------|------------------|---------|
| #1 `empty_state` `/context` exposes zero affordances | 6/6 (top-ranked) | **FALSE POSITIVE** — six independent reports of the same underlying instrumentation gap, presented as overwhelming consensus. |
| #2 `archetype_confusion` Archetype modeling invisible | 6/6 | **HALLUCINATED (compound on #1)** — entirely derivative of /context being read as empty. |
| #9 `broken_link` Duplicate-key + nested `<a>` hydration | 6/6 | **REAL** — concrete console errors, confirmed by parallel terminal's f81dc62 fix. |

**Pattern-level false-positive rate: 2/10 = 20%, but those 2 are the top-ranked.** The synthesis amplifies measurement failure into "consensus" by treating 6 analyzer outputs as 6 independent observations when in fact they're 6 reads of the same broken instrumentation.

---

## Improvement Backlog (ranked)

Priority key: priority = severity × leverage (does fixing this unlock multiple downstream improvements?).

| Rank | Name | Source | Sev | Effort | Sketch |
|------|------|--------|-----|--------|--------|
| **1** | **Detection-confidence: distinguish "no affordance" from "selector failed" from "page not hydrated"** | R1, R2, A1, SCH1 | H | M | Runner: capture per-selector `{matched_count, eval_error, dom_attribute_present}` instead of bare list. Add `instrumentation_gap` to KNOWN_FRICTION_TYPES + Pydantic schemas + system-prompt taxonomy iteration. Analyzer prompt: "if `body_text_length < 100` or `selector_eval_errors > 0` for a route, prefer `instrumentation_gap` over `missing_action`/`empty_state`." Fixes ~50% of the empirical false positives in one move. |
| **2** | **Smarter capture: wait for hydration before reading affordances** | R2 | H | S | Runner: change `wait_until="domcontentloaded"` → wait for either (a) configurable `wait_for_selector` from route, or (b) `body_text_length` to stabilise across two reads 200ms apart, or (c) 3s max. Drops the `body_len=0 / body_len=498` reads on /today and /signals. |
| **3** | **Per-route attribution of console errors + structured action failure types** | R3, R4 | H | S | Runner: snapshot `console_errors` per-route (clear-after-capture), or stamp each error with the route active when it fired. Add structured `error_type` (timeout / not_found / detached / not_visible / blocked_by_overlay) to action-error events. |
| **4** | **Schema: confidence + evidence anchors on FrictionEvent and FrictionPattern** | A4, S3 | H | S | Add `confidence: "high"|"medium"|"low"` and `evidence_event_ts: list[str]` to FrictionEvent. Add `confidence` to FrictionPattern. Prompt update: anchor every event to a JSONL ts; mark `confidence=low` when measurement signals were unreliable. Markdown rendering surfaces a "⚠️ low-confidence" tag. |
| **5** | **Synthesizer: detect single-root-cause masquerading as consensus** | S2, S5 | H | M | After parsing per-persona reports, dedup by (signal_type, location) and flag rows where `personas_affected == all personas` and `evidence` references the same JSONL field (e.g. all six have `visible=[]`). Mark those as `confidence=low` automatically before the LLM call. |
| **6** | **Remove the "3-7 events" / "~10 patterns" floors** | A3, S1 | H | S | Replace with "as many as the evidence supports, up to N; empty is fine." Explicit permission to return zero. |
| **7** | **Centralize friction-type vocabulary** | SCH2 | M | S | Single source of truth in `persona_schema.KNOWN_FRICTION_TYPES`. Pydantic descriptions in analyzer + synthesizer interpolate from that constant. Add `instrumentation_gap` here as part of #1. |
| **8** | **Route schema: `wait_for_selector` + `data_attribute` fallback on actions** | SCH3, SCH4 | M | M | App.yaml schema gets `routes[].wait_for: str` and `actions[].data_attribute?: str`. Runner uses data_attribute as the primary check (cheap, refactor-resistant) and falls back to CSS selector. Update `qa/app.yaml` to use `data-action="run_scan"` style where the dashboard already has it. |
| **9** | **Persona behavioral fidelity: actually use `rejection_threshold`** | R7 | M | M | `behavior.py`: have `rejection_threshold` affect `actions_for_route` (high-threshold persona skips speculative actions; low-threshold tries more). Or document explicitly that it's analyzer-only and remove the runner-side reasoning string that implies it's used. |
| **10** | **Capture `budget_ms` and `over_budget_ratio` on nav events; drop accumulating-error confusion** | R5, R4 | M | XS | Add `budget_ms: int` and `over_budget_ratio: float` to page_state. Subsume reasoning-string parsing. Pair with #3 for console attribution. |
| **11** | **Post-action state capture** | R10 | M | S | After each action, emit a `capture` event with new `body_text_length`, `visible_action_names`, and `url`. Lets analyzer verify the action's effect. |
| **12** | **Synthesizer: aggregate `wins` cross-persona** | S6 | M | S | Mirror the friction pattern aggregation for wins. Output a "What's working" section. |
| **13** | **Effort estimate grounding (or remove)** | S7 | L | S | Either drop `estimated_effort` (don't trust the guess) or feed the synth a rough code-area inventory (`{route: file_count}`) for grounding. |
| **14** | **Detail-route traversal: record attempted-but-unmatched** | R6 | L | XS | Emit a `nav` or `reasoning` event when a parent action expected detail traversal but the URL didn't match any pattern. |
| **15** | **Schema validation: validate analyzer's `signal_type` against app's taxonomy at runtime** | A5 | L | XS | After parsing FrictionReport, drop or flag any event with `signal_type not in app_config.friction_signals types`. |
| **16** | **Synthesizer: stale-report and exclude-persona controls** | S9, S10 | L | XS | CLI flags `--exclude-persona` and `--max-report-age-days`. |
| **17** | **Reset `console_errors` between PersonaRunner.run() calls (latent footgun)** | R11 | L | XS | One-line fix. |

---

## Top 5 high-priority improvements

1. **#1 Detection-confidence** — single biggest noise reducer. Adds `instrumentation_gap` taxonomy slot + structured runner signal + analyzer prompt rule. Fixes the C6 cascade.
2. **#2 Smarter capture** — eliminates the body_len=0 / body_len=498 hydration-time false positives that feed #1's downstream interpretation.
3. **#3 Per-route error attribution + structured action failure types** — fixes the "errors leak across routes" problem and lets severity tier on failure type.
4. **#4 Schema: confidence + evidence anchors** — makes findings auditable and gives downstream a way to defer on low-confidence calls.
5. **#5 Synthesizer single-root-cause detector** — last-line defence against measurement-failure masquerading as 6-persona consensus.

These five together address every category of false positive surfaced in the empirical audit (instrumentation gap, hydration timing, cross-route error attribution, single-source amplification). Estimated effort: ~3-4 hours implementation + ~30 min Phase C re-analysis. Cost: well under $1 (re-analyzer pass on existing 24 sessions).

---

## Architectural finding (not a fundamental block)

The empirical FP rate is ~43% per-event and ~20% on the top-line patterns — concentrated on the top-ranked patterns. This is **noisy but not architecturally broken**. The remediation path (above) is coherent, additive, and doesn't require rewriting any of the three core modules — just adding fields, prompt rules, and one taxonomy slot.

Per the spec's "surprise" threshold ("synthesizer is hallucinating > 30% of patterns"), we are below that bar (20%). The known C6 bug is in scope and ranks #1 because everything else compounds on it, but the audit surfaced four other H-severity issues worth bundling into the same change set.

## Recommendation

Implement #1–#5 in Phase B (~3-4 hours). Defer #6 to #17 to a follow-up unless test changes for #1-#5 expose them as cheap wins. Validate in Phase C by re-running analyzer + synthesizer on the existing 24 JSONLs and diffing.
