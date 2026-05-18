# Scoring Engine Audit — Phase A–E

**Date:** 2026-05-18
**Branch:** `main` (post-merge of `fix/comp-trust-gate` PR #2 — commit `9d8b7ef`)
**Scope:** read-only audit. No fixes, no commits. Single report.
**Method:** code reading + queries against `data/enrichments.json` (1,122 enriched roles, 1,090 with `score_adjusted`).

The engine has three days of layered additions on it (archetype boost, comp trust gate, location remote bonus, anti-signals, hard-no disqualifiers, score clamping). This audit traces it end-to-end and identifies where math, code, config, and data have diverged.

Headline:

- **The "12 drift records that dropped to 0" are not disqualified — they are floor-clamped.** Zero records in the corpus carry `score_disqualified=true`. The drop-to-0 path is `Math.max(0, base+Σdeltas)` flooring, not the hard-no early-return.
- **"CA" is treated as Canada, not California.** `NON_US_CODES` contains `"ca"`, and `isUS()` lowercases before lookup, so every California-region role with `location_region="CA"` or `"ca"` is routed to `onsite_international` (-75) or `hybrid_international` (-50). This is the root cause of several of the "drift" zeros.
- **The dashboard mostly ignores `score_adjusted`.** Only `dashboard-web/lib/company-detail.ts` reads it. The main list (`dashboard-web/lib/data.ts`) reads `enrichment.fit_score` (the raw Claude score), then applies its own independent caps and overrides. The whole G4 layer is invisible to most surfaces — including the surface a human visually scans first.
- **Three keys in `user-context.yaml` never fire.** `location_preferences.hybrid_anywhere_with_nyc_anchor` has no code path. `anti_signals.glassdoor_below_3_5` is declared in code with `patterns: []`. `soft_preferences.diverse_leadership` fires on patterns no JD in the corpus has matched.
- **The $200K floor is declared twice.** `config/user-context.yaml:compensation.floor_usd: 200000` is the consumed value. `config/archetypes.yaml:global_disqualifiers.comp_below: 200000` is validated but never read at scoring time. If one is changed, the other silently drifts.

The rest of the report walks the surface area.

---

## Phase A — Inventory of every adjustment source

Adjustments are emitted in the fixed order documented in `scripts/lib/scoring-layer.mjs:8-15`. Each step appends at most one adjustment per source (soft/anti can append multiple). Final score is `Math.max(0, Math.min(100, baseScore*10 + Σdeltas)) / 10`, rounded to 0.1 (`scoring-layer.mjs:107-110`).

**One-time terminators:** the only short-circuit is the hard-no disqualifier check. It returns early with `score=0, disqualified=true` and skips all remaining adjustments.

| # | Source emitted | File:line | Δ (sign, magnitude) | Reads | Configured | Suppressed by | Observed count in corpus |
|---|---|---|---|---|---|---|---|
| 1 | `disqualifier` (early return) | scoring-layer.mjs:64-73 + checkDisqualifiers :120-141 | resets to `score=0`, sets `disqualified=true` | `role.industry`, `role.description+requirements` (lowercased substring) | `user-context.yaml:hard_nos.industries`, `archetypes.yaml:global_disqualifiers.industries_blocked`, `user-context.yaml:hard_nos.company_signals` | n/a (it suppresses everything else) | **0** records (no record in corpus carries `score_disqualified=true`) |
| 2 | `location:fully_remote` | scoring-layer.mjs:170-194 (key="fully_remote") | +5 fixed | `role.location_workplace == "remote"` | `user-context.yaml:location_preferences.fully_remote` | — | 416 |
| 3 | `location:hybrid_nyc` | :173, key="hybrid_nyc" | +10 fixed | `workplace=="hybrid"` ∧ city ∈ NYC_CITIES (hardcoded :145-150) | `user-context.yaml:location_preferences.hybrid_nyc` | — | 96 |
| 4 | `location:hybrid_nyc_area` | :174, key="hybrid_nyc_area" | +8 fixed | `workplace=="hybrid"` ∧ city ∈ NYC_AREA_CITIES (hardcoded :151-160) | `user-context.yaml:location_preferences.hybrid_nyc_area` | — | **0** |
| 5 | `location:hybrid_sf` | :175 | -40 fixed | `workplace=="hybrid"` ∧ city ∈ {"san francisco","sf"} | `user-context.yaml` | — | 18 |
| 6 | `location:hybrid_la` | :176 | -40 fixed | `workplace=="hybrid"` ∧ city ∈ {"los angeles","la"} | `user-context.yaml` | — | 1 |
| 7 | `location:hybrid_chicago` | :177 | -30 fixed | `workplace=="hybrid"` ∧ city=="chicago" | `user-context.yaml` | — | 3 |
| 8 | `location:hybrid_other_us` | :178 | -25 fixed | `workplace=="hybrid"` ∧ `isUS(region)` | `user-context.yaml` | — | 20 |
| 9 | `location:hybrid_international` | :179 | -50 fixed | `workplace=="hybrid"` ∧ ¬`isUS(region)` | `user-context.yaml` | — | 60 |
| 10 | `location:onsite_nyc` | :180-181 | 0 fixed | `workplace∈{"onsite","on-site"}` ∧ city ∈ NYC{_AREA}_CITIES | `user-context.yaml` | — | 142 |
| 11 | `location:onsite_other_us` | :180,182 | -60 fixed | `workplace∈{"onsite","on-site"}` ∧ `isUS(region)` | `user-context.yaml` | — | 21 |
| 12 | `location:onsite_international` | :180,183 | -75 fixed | `workplace∈{"onsite","on-site"}` ∧ ¬`isUS(region)` | `user-context.yaml` | — | 259 |
| 13 | `comp:not_listed` | scoring-layer.mjs:271-277 | -5 fixed | `comp_range` empty/"not listed"/"none" | `user-context.yaml:compensation.no_comp_listed` | — | 554 |
| 14 | `comp:below_floor` | scoring-layer.mjs:295-299 | -50 fixed | `extractMinComp(comp_range) < floor_usd` | `user-context.yaml:compensation.below_floor_penalty` + `.floor_usd` | `comp:below_floor_suppressed` when trust gate fires | 444 |
| 15 | `comp:below_floor_suppressed` (trust gate) | scoring-layer.mjs:282-294 | 0 (signal-only) | `role.comp_source=="jsonld_basesalary"` ∧ (Claude's `verdict` ∨ any `red_flags`) matches `NO_COMP_PATTERNS` | regex patterns hardcoded :225-233; delta=0 hardcoded :291 | — | 51 (single 2026-05-17 18:56 UTC backfill) |
| 16 | `archetype:<id>` (primary) | scoring-layer.mjs:319-345 | +1..+25 (round), capped via `ARCHETYPE_REWARD_CAP=25` | role.title (lowercased contains), role.description+requirements, role.company, archetype's `reward_signals[].keywords/weight`, `title_signals.{high,medium}_match`, `institutional_companies_boost.{stablecoin_tier,tier_1,tier_2}` | `config/archetypes.yaml` (per-archetype); cap hardcoded `scoring-layer.mjs:28` | — | gtm-engineering 725 / ai-operations 231 / web3-bd 35 / fde 4 / web3-bizops 2 |
| 17 | `archetype:<id>:secondary` | scoring-layer.mjs:91-97 + 287 | `round(primary_delta * 0.5)` | `archetype_secondary[0]` only — additional secondaries are ignored | `SECONDARY_CAP=0.5` hardcoded :27 | — | gtm-engineering:s 19 / fde:s 4 / ai-operations:s 3 / web3-bd:s 2 / web3-bizops:s 1 |
| 18 | `soft:a16z_portfolio` | scoring-layer.mjs:307-315 + patterns :347 | +5 fixed | (description + " " + company), substring contains "a16z" or "andreessen horowitz" | `user-context.yaml:soft_preferences.a16z_portfolio`; patterns hardcoded :347 | — | 6 |
| 19 | `soft:paradigm_portfolio` | :307-315 + patterns :348 | +3 fixed | body contains "paradigm" or "paradigm portfolio" | `user-context.yaml` | — | 1 |
| 20 | `soft:yc_alum` | :307-315 + patterns :349 | +3 fixed | body contains "y combinator", "yc s2", "yc w2", or "yc-backed" | `user-context.yaml` | — | 10 |
| 21 | `soft:ex_founder_team` | :307-315 + patterns :350 | +3 fixed | body contains "ex-founder", "former founder", or "second-time founder" | `user-context.yaml` | — | 1 |
| 22 | `soft:diverse_leadership` | :307-315 + patterns :351 | +2 fixed (config) | body contains "diverse leadership", "underrepresented", or "female-led" | `user-context.yaml` | — | **0** |
| 23 | `anti:acqui_hire_in_last_18_months` | scoring-layer.mjs:323-338 + patterns :371 | -10 fixed | body contains "acqui-hire" or "talent acquisition" | `user-context.yaml:anti_signals.acqui_hire_in_last_18_months` | — | 2 |
| 24 | `anti:five_plus_rounds_in_18_months` | :323-338 + patterns :372 | -10 fixed | body contains "bridge round", "down round", or "extension round" | `user-context.yaml` | — | **0** |
| 25 | `anti:glassdoor_below_3_5` | :323-338 + patterns :373 (`patterns: []`) | DEAD — `patterns.length === 0` is skipped at :333 | n/a | `user-context.yaml:anti_signals.glassdoor_below_3_5: -15` (unused) | unreachable by construction | **0** |
| F | floor/ceiling clamp | scoring-layer.mjs:107 | `Math.max(0, Math.min(100, …))` | sum-of-all-deltas + base*10 | hardcoded | — | 425 records floor-clamp to 0 with `disqualified=false` (138 of those have `fit_score≥3`, 69 have `fit_score≥4`) |

**Things to note from this table:**

- The "drop to 0" path that the audit prompt described as "hard-no disqualified" is in fact the **floor clamp at row F**, not the disqualifier branch at row 1. Of the 425 floor-clamped records, **zero** are flagged disqualified.
- Two stacked penalties (`onsite_international: -75` + `comp:below_floor: -50` = -125) annihilate any plausible base*10 + archetype-cap (max base 100 + cap 25 = 125, ties at 0). For base ≤ 9 it is already mathematically guaranteed to hit the floor before any positive signal can rescue it.
- Three configured keys never emit: `hybrid_anywhere_with_nyc_anchor` (no code path), `glassdoor_below_3_5` (empty pattern list), `diverse_leadership` (patterns are real but didn't match any JD in the corpus — judgment call whether to keep or drop).
- The `hybrid_nyc_area` key has a code path but produced zero records — likely because scan-jobs has been classifying Brooklyn/JC/Hoboken at the `city` field with non-lowercased values or the upstream NYC normalizer routes them to `New York`. Either way, the bucket is empty.
- The institutional Web3 boost has **two separate magnitudes for the same tiers**, one in the classifier and one in the scoring layer: classifier emits `+60/+20/+10` to fitness (archetype-classifier.mjs:153-160), scoring layer emits `+35/+12/+6` to the lens (scoring-layer.mjs:335-337). These are read from the same `institutional_companies_boost` config but the numbers are hardcoded in both files.

---

## Phase B — Three end-to-end role traces

Each trace walks the running total at each step. Base internal = `baseScore × 10`. All deltas are summed first, then `Math.max(0, Math.min(100, base+Σ))` is applied (i.e., the clamp is end-of-pipeline, not per-step).

### B.1 — Anaconda · GTM Engineer (comp trust gate fires, gtm-eng, fully remote)

**Source:** `https://builtin.com/job/gtm-engineer/8843434`, `data/enrichments.json` entry under that key.

| Step | Adjustment | Δ | Running internal | Running display |
|---|---|---:|---:|---:|
| 0 | base `fit_score = 8` (Claude) | +80 | 80 | 8.0 |
| 1 | `location:fully_remote` (workplace="remote") | +5 | 85 | 8.5 |
| 2 | `comp:below_floor_suppressed` (comp_source=`jsonld_basesalary`; `red_flags` includes "No compensation mentioned"; verdict mentions "no comp listed is concerning") — `comp_range` parsed as $101,500–135,000, below `floor_usd=200,000`, but trust gate fires → delta=0 instead of -50 | 0 | 85 | 8.5 |
| 3 | `archetype:gtm-engineering` (primary; raw=30 — "Python", "Clay", "HubSpot", "outbound", "signal", "AI-native", "agent", title "GTM Engineer" = high-match +8; raw capped at 25) | +25 | 110 | 11.0 |
| F | clamp `min(100, 110)` → 100 → /10 | — | 100 | **10.0** |

**Non-obvious bit:** the trust gate is the only thing keeping this from being floor-clamped. With the legacy `-50` penalty: 80 + 5 - 50 + 25 = 60 → 6.0 (which is exactly what was persisted before the May 17 backfill — see `docs/audits/2026-05-18-comp-trust-gate-rescore.md` "Anaconda — the audit-trigger role"). The gate is doing real work here, but it's also *the only reason* the final score isn't floor-clamped, which means a single Claude verdict-text change (Claude on a re-run not saying "no comp listed") flips this role from 10.0 → 6.0. That's brittle.

**Also non-obvious:** the score hits the upper clamp at 10/10 — a *perfect score* — on a role whose comp data the system itself tagged as unverified. The prior audit doc explicitly flagged this as a Phase 1.5 smell (see "Note — Anaconda 10/10 smell"). Surfaced again in Phase C.1 below.

### B.2 — OpenAI · Product Engineer, GTM Innovation (drift to 0)

**Source:** `https://builtin.com/job/product-engineer-gtm-innovation/7239792`. Persisted state in `enrichments.json` (last `score_adjusted_at: 2026-05-17 18:56:37`):

```json
"score_base": 7, "score_adjusted": 9.3, "score_disqualified": false,
"score_adjustments": [
  {"source":"archetype:web3-bd",      "delta":20, "reason":"lens raw=20 cap=25 mult=1"},
  {"source":"soft:ex_founder_team",   "delta":3,  "reason":"JD/company marker"}
]
```

Re-running today's `adjustScore` against the live `seen-urls.json` entry (which has `location_workplace="onsite"`, `location_city="san francisco"`, `location_region="ca"`) produces a very different result:

| Step | Adjustment | Δ | Running internal | Running display |
|---|---|---:|---:|---:|
| 0 | base `fit_score = 7` | +70 | 70 | 7.0 |
| 1 | `location:onsite_international` — workplace="onsite", city="san francisco", region="ca" → `isUS("ca")` returns false because `"ca" ∈ NON_US_CODES` (Canada) → falls through to international (`scoring-layer.mjs:182-183, 199-205, 207-213`) | -75 | -5 | -0.5 |
| 2 | `comp:below_floor` — comp_range $230,000–$385,000, min=230,000 ≥ floor=200,000 → no penalty | 0 | -5 | -0.5 |
| 3 | `archetype:web3-bd` — historic classification; if re-classified today the persisted body (synthesized from verdict+stack — no Web3 keywords for an OpenAI Product Engineer role) yields raw=0 → no archetype adjustment | 0 | -5 | -0.5 |
| 4 | `soft:ex_founder_team` — depends on whether `ex-founder`/`former founder`/`second-time founder` survives in the synthesized description text Claude wrote | +3 (if matches) | -2 | -0.2 |
| F | clamp `max(0, -2)` → 0 → /10 | — | 0 | **0.0** |

**Non-obvious bit:** the entire delta from 9.3 to 0 comes from row 1 — the `"ca"` ambiguity. **California's two-letter code "CA" is in the same bucket as Canada's "CA".** `isUS()` lowercases the input before lookup (`scoring-layer.mjs:209`), and `NON_US_CODES.has("ca")` returns true (`scoring-layer.mjs:202`). So every California-region role is silently routed to international.

This is amplified by the fact that the persisted record had NO location adjustment at all (the seen-urls entry was missing `location_region` when first scored). When the locations-backfill ran (see `reports/backfill-locations-2026-05-13.md`), it populated `location_region="ca"` for many roles, which then triggered `-75` on the next re-score.

### B.3 — Notion · GTM AI Engineer (clean middle — no clamp, no DQ, two small adjustments)

**Source:** `https://jobs.ashbyhq.com/notion/0e7b494f-6077-4620-a15b-592ef738a210`. Persisted state:

```json
"score_base": 4, "score_adjusted": 2.3, "score_disqualified": false, "score_adjustments": [
  {"source":"location:hybrid_nyc",                     "delta":10},
  {"source":"comp:below_floor",                        "delta":-50},
  {"source":"archetype:ai-operations",                 "delta":10},
  {"source":"archetype:gtm-engineering:secondary",     "delta":13}
]
```

| Step | Adjustment | Δ | Running internal | Running display |
|---|---|---:|---:|---:|
| 0 | base `fit_score = 4` | +40 | 40 | 4.0 |
| 1 | `location:hybrid_nyc` | +10 | 50 | 5.0 |
| 2 | `comp:below_floor` — Notion JD lists $150K–$190K (below $200K floor) | -50 | 0 | 0.0 |
| 3 | `archetype:ai-operations` (primary; raw=10) | +10 | 10 | 1.0 |
| 4 | `archetype:gtm-engineering:secondary` (raw=25 capped, then `round(25 × 0.5)` = 13) | +13 | 23 | 2.3 |
| F | no clamp triggered (0 ≤ 23 ≤ 100) → /10 | — | 23 | **2.3** |

**Non-obvious bit:** the secondary archetype adjustment (`+13`) is half of a *fully-capped* primary equivalent. A primary `gtm-engineering` on the same body would have given +25 raw → +25 capped. As a secondary it's +13. So `gtm-engineering` is being applied *twice* — once at full strength as the secondary's source archetype, and once at 0.5x as a secondary adjustment. The total contribution of "the role looks GTM-eng-ish" therefore depends on whether the classifier picked `ai-operations` or `gtm-engineering` as primary. Order of classifier ties matters more than it should — see Phase C.3.

Also: hybrid_nyc (+10) + below_floor (-50) is a -40 net. The role *is* in NYC, which is the highest-fit location bucket, but the comp posting drags it underwater. This is the math behaving as configured, and it surfaces a legitimate scoring choice (comp ranks higher than location preference). Worth noting, not necessarily wrong.

---

## Phase C — Interaction analysis

### C.1 — Upper clamp hit by archetype + comp-suppression stacking

**Adjustments interacting:** `location:fully_remote` (+5) + `comp:below_floor_suppressed` (0) + `archetype:<primary>` (up to +25, often capped).

**Example:** Anaconda (B.1 above) lands at exactly 10.0 because the base is 8 and the positive adjustments overflow the [0, 100] ceiling. The previous audit doc flagged this explicitly ("Anaconda 10/10 smell", Phase 1.5 candidate).

**Current behavior:** A role whose comp is *unverified* (the gate suppressed the floor penalty, didn't validate it) can land at a perfect 10/10. From a downstream-reader's perspective, 10/10 looks like the highest possible signal — it doesn't visibly distinguish "we verified everything passed" from "we suppressed a check we couldn't trust."

**Intended or accidental?** The trust gate PR was explicit that the suppression is signal-only (delta=0) and the score boost is incidental. The 10/10 clamp interaction was called out in the gate's own audit doc as a candidate Phase 1.5 issue. So: known accidental, parked.

**Fix shape (don't implement):** when `comp:below_floor_suppressed` is in the adjustment list, cap the final `score_adjusted` at ~8.5 or 9.0 (treat as "verified pending" rather than "fully verified"). Implementation: post-clamp check in `scoring-layer.mjs:107` that lowers the ceiling when a specific adjustment source is present.

How many records this affects today: 51 (every record carrying `comp:below_floor_suppressed`). Of those, the upper-clamp visibility surface is limited to roles where the suppression made the difference between a clamp and a non-clamp — I count two such 10/10 cases in the audit doc (Anaconda, Snorkel AI Senior GTM Engineer; FOSSA also hits 10).

### C.2 — Lower clamp masking how penalized a role really is

**Adjustments interacting:** any pair of strong negatives (e.g., `location:onsite_international: -75` + `comp:below_floor: -50` = -125, or `location:hybrid_international: -50` + `comp:below_floor: -50` = -100).

**Example:** any of the 69 records with `fit_score ≥ 4` that floor-clamp to 0 (full list in Phase D below). All these records have a base*10 well under the floor-distance, and the engine returns `score_adjusted=0, disqualified=false`. The disqualified flag is the ONLY signal a downstream reader can use to distinguish "we explicitly rejected this" from "the math piled up enough negative for a clamp." Both render as `0/10`.

**Intended or accidental?** The hard-no path was designed for explicit, named rejections (industries, company signals). The clamp at 0 is a math-correctness floor. Conflating them in the data is accidental — the engine doesn't expose any flag like `score_clamped_floor` to make it observable.

**Fix shape:** add an optional flag `score_clamped_at_floor: true` (or a third adjustment source `clamp:floor`) when the unclamped sum goes negative. Doesn't change math, just makes the clamp observable downstream so the dashboard can distinguish "hard rejected" from "out-priced/out-located." Implementation: 2-line change at `scoring-layer.mjs:107`.

### C.3 — Order dependence in archetype lens — `gtm-engineering` is preferred as primary

**Adjustments interacting:** `archetype:<primary>` vs `archetype:<secondary>` for the same body. The classifier picks primary based on raw_score tie-breaking (`archetype-classifier.mjs:174`: sorted by `raw_score`, with implicit stable order). The scoring layer then applies primary at 1.0 and *only first secondary* at 0.5 (`scoring-layer.mjs:91-97`).

**Why it matters:** a role like the Notion case (B.3) gets +10 (ai-operations as primary) + +13 (gtm-engineering as half-capped secondary) = +23. Had the classifier picked `gtm-engineering` as primary, the role would have gotten +25 (capped primary) + +5 (half of raw-10 ai-operations secondary) = +30 → final +7 instead of -27 in the unclamped delta. That's a 1-point shift on the 0-10 scale based on a tie-break.

**Intended or accidental?** Probably accidental — there's no documented preference rule. The classifier sort comment (`archetype-classifier.mjs:172-174`) says "Sort by raw_score (not fitness) so ties between saturated archetypes resolve to the higher absolute scorer rather than YAML order." Which means ties at the raw level fall back to YAML insertion order (since `Array.sort` is stable). YAML order is `gtm-engineering, ai-operations, fde, web3-bd, web3-bizops` — so on raw ties, **gtm-engineering wins**. This is a structural bias toward the user's top archetype that nothing in the config says is the intent.

**Fix shape:** if the bias toward `gtm-engineering` on ties is desired, document it in `archetypes.yaml` (`primary_on_tie: gtm-engineering` or similar) and apply it in the classifier explicitly rather than relying on YAML key order. If not desired, break ties differently (e.g., title-signal-only as tiebreaker).

### C.4 — Smell test: high-base roles with mixed signals landing at 10/10 or 0/10

Looking at the top 30 positive deltas in the corpus, 7 records have `score_adjusted=10` despite `score_base ≤ 8`. The combinations all involve the trust gate stacking with fully_remote + a fully-capped archetype lens. The math is correct; the result *feels* hot for what is, post-gate, "we couldn't trust the comp data" rather than "we verified the comp is good."

Inverse smell at the bottom: 425 floor-clamped zeros, of which 69 had `fit_score ≥ 4` (Claude flagged them as fits). Two specific patterns recur:
- onsite SF/CA roles routed to `onsite_international` due to the `"ca" = Canada` bug (Phase B.2)
- comp listed but below floor — the floor penalty is heavy enough alone (-50) to floor any role with `fit_score ≤ 5` on the 0-10 display when combined with `location:onsite_*`

The math is doing exactly what the config says. The smell is in the *config magnitudes*, not the engine itself.

---

## Phase D — Hard-no / disqualifier audit

**TL;DR — there are no disqualified records in the corpus.** `score_disqualified=true` count: 0. The "12 drift records" the audit prompt mentioned are floor-clamped, not disqualified. The hard-no branch (`scoring-layer.mjs:64-73`) has never fired against this dataset.

### D.1 — What hard-no rules exist and when they were added

Source: `scoring-layer.mjs:120-141` (function `checkDisqualifiers`).

| Rule source | File:line | Added (commit) | What it matches |
|---|---|---|---|
| `globalDQ.industries_blocked` | scoring-layer.mjs:124-125 reading `archetypes.yaml:166` | `be22fd0` (2026-04-?) | substring lowercase match of any item against `role.industry` OR `(description+requirements)` |
| `userContext.hard_nos.industries` | scoring-layer.mjs:126 reading `user-context.yaml:36` | `d851248` (additive scoring layer) | same matching as above |
| `userContext.hard_nos.company_signals` | scoring-layer.mjs:134-138 reading `user-context.yaml:37` | `d851248` | substring match on `(description+requirements)` with hyphens replaced by spaces (e.g., `layoffs-announced-30d` → "layoffs announced 30d") |

Effective hard-no terms after merging the two industry lists:

`["consumer-only", "gambling", "weapons", "predatory-lending", "mlm", "vape", "tobacco"]` (from user-context.yaml) ∪ `["gambling", "weapons", "predatory-lending", "mlm", "tobacco", "vape"]` (from archetypes.yaml). The union is the same minus `consumer-only`, which only exists in user-context.yaml.

Effective company-signal terms (after `replace(/-/g, " ")`):

- `"layoffs announced 30d"`
- `"ceo fired 30d"`
- `"sec investigation"`
- `"lawsuit pending"`

### D.2 — Why "OpenAI 9.3 → 0, Introhive 5 → 0, Enable 4.9 → 0" dropped — *not from hard-nos*

All 12 of the drift records named in `docs/audits/2026-05-18-comp-trust-gate-rescore.md` are floor-clamped, not disqualified. Walking three named cases:

| Record | Cause | Trace |
|---|---|---|
| **OpenAI Product Engineer, GTM Innovation** | `"ca" → Canada` location bug | base 70 + onsite_international(-75) + soft:ex_founder_team(+3) = -2 → clamp 0 (full trace in B.2) |
| **Introhive Head of GTM Enablement** | onsite Toronto + onsite_international + no comp = stacked negatives | base 50 + onsite_international(-75, region=null but city=toronto → international) + comp_not_listed(-5) + archetype_gtm(<25) = -5 to -30 → clamp 0 |
| **Enable Director of Revenue Operations** | onsite (region likely null) + below floor | base ~50 + onsite_international + comp_below_floor + archetype(<25) → clamp 0 |

None of these match any term in `industries_blocked`, `hard_nos.industries`, or `hard_nos.company_signals`. They are entirely floor-clamp interactions.

### D.3 — Are any hard-nos over-broad?

The substring match on `role.description` (lowercased) is the highest-risk surface — substrings of "weapons" or "gambling" could fire on JDs that *describe the company's risk surface* rather than *say the company is in that industry*. E.g., a security or fintech JD mentioning "weapons-grade encryption" would (literally) match the `weapons` rule and disqualify the role.

That said: **the corpus has zero disqualifications**. The over-broadness isn't biting anyone today. But the surface is there. Real-world risk:

- `"tobacco"` — match would fire on a tobacco-cessation health app JD
- `"mlm"` — three-letter substring; could fire on a multi-level marketing detection startup's JD
- `"weapons"` — would fire on any defense-tech JD that *mentions* weapons; the team probably wants `weapons` excluded as an industry but **not** auto-disqualified from a defense-platform JD that lists it
- `"vape"` — extremely narrow; safe

**Mitigation (don't implement):** match on `role.industry` only (a structured field) for industries, not on description text. Drop the description substring match for industries since it's just noise. The signal coming from `industry` is rare too — most enrichments have no industry field populated — but at least it's structured.

### D.4 — Are Nick's stated deal-breakers (NYC, $200K floor) actually hard-nos?

Per memory, Nick has stated deal-breakers around NYC and the $200K floor. **Neither is currently a hard-no.** They are scoring-layer penalties:

| Stated deal-breaker | Engine treatment today | Hard-no? |
|---|---|---|
| NYC anchor (no SF/LA/other-US onsite) | `location:onsite_other_us: -60`, `onsite_international: -75`, `hybrid_sf/la: -40` | **No** — heavy penalty, but a base-10 role with +25 archetype could still surface (10*10 - 60 + 25 = 65 → 6.5) |
| $200K comp floor | `comp:below_floor: -50` (or suppressed by trust gate) | **No** — same math: a base-10 role with +25 archetype survives at 6.5 |
| 100% on-site SF / LA / Seattle / Austin / Chicago | `archetypes.yaml:global_disqualifiers.location` lists "fully on-site SF" etc. | **No-op** — `getGlobalDisqualifiers().location` is loaded but never read by `scoring-layer.mjs`. Verified: grep `globalDQ.location` returns nothing. The list is dead config. |

**The third row is the most interesting.** `config/archetypes.yaml:158-164` declares:

```yaml
global_disqualifiers:
  location:
    - "fully on-site SF"
    - "fully on-site LA"
    - "fully on-site Seattle"
    - "fully on-site Austin"
    - "fully on-site Chicago"
```

This is *exactly* the stated deal-breaker shape — "fully on-site $CITY" should drop the role to 0. But `checkDisqualifiers` (scoring-layer.mjs:120-141) reads `globalDQ.industries_blocked` only. The location list is loaded into memory and never consulted. The matching code does not exist.

Fix shape (don't implement): extend `checkDisqualifiers` to handle `globalDQ.location` as substring matches against a flattened `${role.location_workplace} ${role.location_city}` string. Or — better — move "fully on-site SF" semantics into structured `location_workplace` × `location_city` matching against a config list. Two-deep field access; small change.

### D.5 — Hard-no rules that probably never fire by construction

- `hard_nos.company_signals = ["layoffs-announced-30d", "ceo-fired-30d", "sec-investigation", "lawsuit-pending"]` — substring-matched (with hyphens → spaces) against the JD. A JD will essentially never contain the literal phrase `"layoffs announced 30d"`. These are user-facing concept tags that need an external company-state lookup, not a JD text match. **0 hits.**
- `industries_blocked` — JDs of B2B SaaS companies rarely include the literal string `gambling` or `weapons`. **0 hits in corpus.**

The hard-no system as designed is currently doing no work. None of its config values are operative.

---

## Phase E — Config-to-behavior mapping

This phase lists every YAML key under `config/user-context.yaml` and `config/archetypes.yaml` and traces where it's read at scoring time. Schema-validation reads (e.g., `archetype-config.mjs:99-105` validating `reward_signals[].weight`) are noted but not counted as "consumed at scoring."

### E.1 — `config/user-context.yaml`

| Key | Effect at scoring | Reader | Operative? |
|---|---|---|---|
| `identity.home_city`/`home_state`/`home_country` | — | not read by any `*.mjs` (grep `home_city` returns nothing in scripts/) | **DEAD** — purely informational |
| `location_preferences.fully_remote` | +5 delta | scoring-layer.mjs:188-194 via `prefs[key]` | ✓ |
| `location_preferences.hybrid_nyc` | +10 delta | same | ✓ |
| `location_preferences.hybrid_nyc_area` | +8 delta | same | ✓ — but 0 emissions in corpus (no role routed to this bucket) |
| `location_preferences.hybrid_anywhere_with_nyc_anchor` | 0 in config | same | **DEAD** — no code path; the key is loaded into `prefs` but no city/region/workplace combo ever maps to `"hybrid_anywhere_with_nyc_anchor"` |
| `location_preferences.hybrid_sf` | -40 | same | ✓ |
| `location_preferences.hybrid_la` | -40 | same | ✓ |
| `location_preferences.hybrid_chicago` | -30 | same | ✓ |
| `location_preferences.hybrid_other_us` | -25 | same | ✓ |
| `location_preferences.hybrid_international` | -50 | same | ✓ |
| `location_preferences.onsite_nyc` | 0 | same | ✓ |
| `location_preferences.onsite_other_us` | -60 | same | ✓ |
| `location_preferences.onsite_international` | -75 | same | ✓ |
| `compensation.floor_usd` | base for floor comparison | scoring-layer.mjs:281, 298 | ✓ |
| `compensation.target_usd` | — | not read at scoring (grep `target_usd` returns no scoring sites) | **DEAD** at scoring; may be referenced in `_profile.md` Claude prompt — not material to engine math |
| `compensation.below_floor_penalty` | -50 magnitude | scoring-layer.mjs:297 | ✓ |
| `compensation.no_comp_listed` | -5 magnitude | scoring-layer.mjs:275 | ✓ |
| `hard_nos.industries[]` | substring match for DQ | scoring-layer.mjs:126 | code-active, **never fires** in corpus |
| `hard_nos.company_signals[]` | substring match (hyphen→space) for DQ | scoring-layer.mjs:134 | code-active, **never fires** in corpus (JDs don't carry these phrases) |
| `soft_preferences.a16z_portfolio` | +5 | scoring-layer.mjs:308 via pattern table | ✓ (6 emissions) |
| `soft_preferences.paradigm_portfolio` | +3 | same | ✓ (1) |
| `soft_preferences.yc_alum` | +3 | same | ✓ (10) |
| `soft_preferences.ex_founder_team` | +3 | same | ✓ (1) |
| `soft_preferences.diverse_leadership` | +2 | same | code-active, **0 emissions** (patterns don't match) |
| `anti_signals.acqui_hire_in_last_18_months` | -10 | scoring-layer.mjs:330 | ✓ (2) |
| `anti_signals.five_plus_rounds_in_18_months` | -10 | same | code-active, 0 emissions |
| `anti_signals.glassdoor_below_3_5` | -15 (config) | scoring-layer.mjs:333 SKIPS due to `patterns.length === 0` at :333 | **DEAD by skip** — the comment says "requires external data; skipped at JD time" but the -15 value just sits there. Either implement the external Glassdoor lookup or delete the config row. |

### E.2 — `config/archetypes.yaml`

| Key | Effect at scoring | Reader | Operative? |
|---|---|---|---|
| `archetypes[].id`/`name`/`maturity`/`resume`/`description` | validation only | archetype-config.mjs:69-117 | structural — operative for config-load |
| `archetypes[].required_signals[]` | — | not read by scoring or classifier (grep `required_signals` finds only `archetypes.yaml` itself) | **DEAD** — declared per-archetype but never consulted |
| `archetypes[].reward_signals[].keywords/weight` | archetype lens raw additions | scoring-layer.mjs:325-329 (lens), archetype-classifier.mjs:142-149 (classifier) | ✓ |
| `archetypes[].title_signals.high_match/medium_match/low_match` | classifier raw +100/+50/+20 (classifier-only) + scoring-layer +8/+4 high/medium (`low_match` IGNORED) | classifier :131-140, scoring-layer.mjs:341-344 | partially — `low_match` is referenced in classifier but **not** in scoring-layer (where only high/medium are bonuses) |
| `archetypes[].company_filter.require_b2b_saas` | — | not read (grep) | **DEAD** — declared on gtm-engineering, never consulted |
| `archetypes[].company_filter.exclude_industries[]` | — | not read | **DEAD** |
| `archetypes[].company_filter.require_ai_native_signals` | — | not read | **DEAD** — declared on ai-operations |
| `archetypes[].institutional_companies_boost.stablecoin_tier[]` | classifier +60, scoring-layer +35 — **two hardcoded magnitudes** | archetype-classifier.mjs:153-154, scoring-layer.mjs:335 | ✓ but magnitudes duplicated |
| `archetypes[].institutional_companies_boost.tier_1[]` | classifier +20, scoring-layer +12 | classifier :156-157, scoring-layer.mjs:336 | ✓ but magnitudes duplicated |
| `archetypes[].institutional_companies_boost.tier_2[]` | classifier +10, scoring-layer +6 | classifier :159-160, scoring-layer.mjs:337 | ✓ but magnitudes duplicated |
| `archetypes[].institutional_companies_boost.inherit_from` | inheritance resolution at config load | archetype-config.mjs:119-137 | ✓ |
| `global_disqualifiers.location[]` | (intended: full-onsite-city DQ) | **never read** — `checkDisqualifiers` (scoring-layer.mjs:120-141) only consults `globalDQ.industries_blocked`. `getGlobalDisqualifiers` returns the full object, but the `.location` field is dropped. | **DEAD by omission** — this is the gap Nick's "no on-site SF/LA/Chicago/Austin/Seattle" deal-breaker would naturally live in. See P0-3 below. |
| `global_disqualifiers.comp_below` | (intended: comp floor for DQ) | not read at scoring; only validated as a number (archetype-config.mjs:113-115) | **DEAD** — duplicates `user-context.yaml:compensation.floor_usd: 200000`. The only read site is the validator. **Three-floor problem candidate.** |
| `global_disqualifiers.industries_blocked[]` | substring DQ match | scoring-layer.mjs:124-125 | ✓ |

### E.3 — Hardcoded values that DUPLICATE config

These are values written into source code that have a config-key counterpart, creating drift risk:

| Hardcoded site | Magnitude | Config key it shadows | Risk |
|---|---|---|---|
| `scoring-layer.mjs:27` `SECONDARY_CAP=0.5` | secondary archetype multiplier | none — no config key | not a duplicate, but is a *tunable* that's not surfaced |
| `scoring-layer.mjs:28` `ARCHETYPE_REWARD_CAP=25` | archetype lens cap | none — no config key | same as above |
| `scoring-layer.mjs:29` `SCALE=10` | base/internal multiplier | none | structural; fine |
| `scoring-layer.mjs:145-160` `NYC_CITIES`/`NYC_AREA_CITIES` sets | city list for location buckets | none | should arguably live in config so users can extend (Hoboken, LIC, etc.) |
| `scoring-layer.mjs:199-205` `NON_US_CODES` | what counts as non-US | none | **bug source** — California's `"ca"` lives here as Canada (B.2/P0-2) |
| `scoring-layer.mjs:225-233` `NO_COMP_PATTERNS` regex | what counts as "Claude says no comp" | none | reasonable to keep in code, but no override path |
| `scoring-layer.mjs:347-352` `SOFT_PREF_PATTERNS` | text patterns for soft prefs | only the *magnitude* is in config; the *patterns* are hardcoded | user can't add a new soft pref without code; tightly coupled |
| `scoring-layer.mjs:371-373` `ANTI_SIGNAL_PATTERNS` | text patterns for anti-signals | same as above | same as above |
| `archetype-classifier.mjs:132,134,138` `+100/+50/+20` for title-match | classifier title weights | none — buried in code | should be config to let users tune title sensitivity |
| `archetype-classifier.mjs:154,157,160` `+60/+20/+10` Web3 boosts | duplicates the scoring-layer's `+35/+12/+6` — they read the same `institutional_companies_boost` config but emit different magnitudes | shadows `scoring-layer.mjs:335-337` | **DRIFT** — bump one and the other diverges silently |
| `scoring-layer.mjs:281,298` `floor_usd` from config + `archetypes.yaml:165` `comp_below: 200000` | both encode "$200K floor" | **three-floor problem candidate** | one config edit, only the user-context one takes effect; archetypes.yaml's value is validated-only |

**The "three-floor problem" the prompt asked about exists in the smaller form of a "two-floor problem":** `compensation.floor_usd: 200000` (the live floor) vs `global_disqualifiers.comp_below: 200000` (validated, never read). The third copy isn't a comp value in code — but `modes/_profile.md`'s Claude prompt also restates the floor to Claude, which is a third surface where the same number is duplicated.

---

## Top findings (ranked by "does the math match intent")

Most severe first. Each lists what's wrong, why it matters, and a rough fix shape. No fixes are applied.

1. **California's `"ca"` is treated as Canada.** `NON_US_CODES` contains `"ca"`, and `isUS()` lowercases before set lookup (`scoring-layer.mjs:202, 209`). Every California-region role (workplace=onsite or hybrid) is routed to international (-75 or -50). This is the single biggest source of the "drift to 0" records — OpenAI Product Engineer (9.3 → 0), Insight Partners, Skydio, Databricks, and many of the 69 high-base floor-clamps land here. **Fix shape:** in `isUS`, treat 2-letter inputs that look like US state codes specifically (whitelist US states) OR distinguish ambiguous codes by also reading `location_country`. Two-line change. Re-score affects roughly 50-80 records.

2. **Floor-clamping is conflated with hard-no disqualification at the output.** 425 records have `score_adjusted=0` and `score_disqualified=false`. Downstream consumers can't distinguish "we explicitly rejected this" from "the math clamped to floor." The `disqualified` flag was supposed to be the signal, but it never fires (because no actual hard-no terms match). **Fix shape:** expose a third boolean like `score_clamped_at_floor` or a clamp adjustment source so the dashboard / triage can render the two cases differently. Doesn't change scoring math; changes observability.

3. **`global_disqualifiers.location` is loaded but never read.** `archetypes.yaml:158-164` declares "fully on-site SF/LA/Seattle/Austin/Chicago" as hard-nos — those *are* Nick's stated deal-breakers. But `checkDisqualifiers` (scoring-layer.mjs:120-141) only reads `.industries_blocked`. The location DQ list is silent config. **Fix shape:** extend `checkDisqualifiers` to test `role.location_workplace="onsite" + role.location_city ∈ <city set from config>`. This converts SF/LA/Chicago/Austin/Seattle onsite roles from "floor-clamped via stacking" to "explicitly disqualified" — which means they'd correctly carry `score_disqualified=true` and be observably different from floor-clamps.

4. **The dashboard mostly ignores `score_adjusted`.** `dashboard-web/lib/data.ts:297-298` uses `enrichment.fit_score` for the main list. Only `dashboard-web/lib/company-detail.ts:131-132` reads `score_adjusted`. The G4 layer (archetype lens, comp floor, location penalty, hard-nos, trust gate) is invisible to /pipeline, /signals, and most of the dashboard. A role that the engine sends to 0 still displays at its raw fit_score on the main surfaces. **Fix shape:** decide which is canonical, then make the dashboard read it consistently. If `score_adjusted` is canonical, replace `enrichment.fit_score` at `data.ts:298`. If `fit_score` is canonical (because Claude is the source of truth), document that the G4 layer is for *re-ranking* only and stop persisting `score_adjusted` to data.

5. **Trust-gate stacking can produce a perfect 10/10 on unverified data.** The trust gate is signal-only (delta=0), but its presence + a fully-capped archetype lens + remote+5 lands roles like Anaconda at the upper clamp. A 10/10 reading is "we verified everything passed," but a 10/10 with `comp:below_floor_suppressed` in the adjustments is "we suppressed a check." Already known (audit doc Phase 1.5 note). **Fix shape:** post-clamp ceiling drop when `comp:below_floor_suppressed` is present — e.g., cap at 8.5 or 9.0. One-line addition at scoring-layer.mjs:107-109. Affects 2-7 records today.

6. **`anti_signals.glassdoor_below_3_5: -15` is dead config.** Code declares the key with `patterns: []` (`scoring-layer.mjs:373`), which the loop at `:333` skips. The comment says "requires external data; skipped at JD time." Either implement the Glassdoor lookup at enrich time or delete the config row. **Fix shape:** delete the unused config key + the dead code branch, OR wire up an external lookup. As-is it's noise that suggests the engine considers Glassdoor when it doesn't.

7. **`hard_nos.company_signals` (`"layoffs-announced-30d"` etc.) never fires by construction.** The substring match (with hyphens→spaces) against the JD body looks for phrases like "layoffs announced 30d" — which no JD contains. These are concept tags that need an external company-state lookup, like the Glassdoor case. **Fix shape:** either implement an external company-signals lookup at enrich time or remove these keys from config. The current setup gives a false sense of safety.

8. **Institutional Web3 boost magnitudes are duplicated in code.** `archetype-classifier.mjs:153-160` and `scoring-layer.mjs:335-337` both read `institutional_companies_boost` but emit different magnitudes (+60/+20/+10 vs +35/+12/+6). Changing the classifier's bias doesn't change the scoring lens, and vice versa. **Fix shape:** move the magnitudes to `archetypes.yaml:institutional_companies_boost.weights` (or similar) and read them from one place. Or accept that classifier and scoring have separate scales and *document* that — the current setup looks like a bug.

9. **`required_signals`, `company_filter.*`, `target_usd`, `identity.*`, `low_match` (in scoring layer) are unused config.** Declared but no reader at the scoring layer. Either implement them or remove from config. They confuse readers who assume what's in YAML matters. **Fix shape:** delete each (verify by grep first) or wire them up to the engine.

10. **Two copies of "$200K floor": `compensation.floor_usd` (live) and `global_disqualifiers.comp_below` (validated-but-never-read).** Change one, the other silently drifts. Same value today, but no enforcement of consistency. **Fix shape:** drop `global_disqualifiers.comp_below` from `archetypes.yaml` since the validator is its only reader, or have the scoring engine consume it (preferably the latter, paired with finding 3 — make `global_disqualifiers` actually disqualify).

---

## Suggested next steps

### P0 — math is actually wrong, fix soon

- **P0-1: California is Canada.** `scoring-layer.mjs:199-205` `NON_US_CODES` + `isUS` at :207-213. Fix the `"ca"` ambiguity. Re-score the corpus afterward. Roughly 50–80 records affected. Pair with a unit test covering `CA`, `ca`, `California`, `New York`, `NY`.
- **P0-2: `global_disqualifiers.location` is unread.** Make `checkDisqualifiers` consult the location list so Nick's "no on-site SF/LA/Chicago/Austin/Seattle" deal-breaker actually disqualifies (sets `score_disqualified=true`) instead of just floor-clamping. Converts roughly 30–50 records from "0/10, looks normal" to "0/10, explicitly DQ" — observability win.
- **P0-3: Dashboard reads `fit_score`, not `score_adjusted`.** Pick a canonical score and align `dashboard-web/lib/data.ts:297-303` with the engine output. Without this, the G4 layer is decoration that doesn't reach the user.

### P1 — math is right but the config is sloppy

- **P1-1: Expose floor-clamp as an observable signal** (`score_clamped_at_floor: true` or a `clamp:floor` adjustment source). Two-line change at `scoring-layer.mjs:107`. Lets the dashboard distinguish "explicitly rejected" from "out-priced/out-located."
- **P1-2: Cap upper bound when `comp:below_floor_suppressed` is in adjustments** (the Anaconda 10/10 smell). Post-clamp ceiling at 8.5 or 9.0.
- **P1-3: Reconcile the institutional Web3 boost magnitudes.** One source of truth in `archetypes.yaml`. Currently classifier and scoring-layer disagree on weight ratios.
- **P1-4: Document or remove `SECONDARY_CAP`, `ARCHETYPE_REWARD_CAP`, NYC city sets.** Either make them config-tunable or document why they're hardcoded.
- **P1-5: Eliminate the `comp_below` duplicate** between `user-context.yaml` and `archetypes.yaml`. Make `archetypes.yaml:global_disqualifiers.comp_below` either the canonical floor and have scoring read it, or delete it.

### P2 — cleanup, not urgent

- **P2-1: Delete or implement dead config** — `identity.*`, `compensation.target_usd`, `hybrid_anywhere_with_nyc_anchor`, `anti_signals.glassdoor_below_3_5` (and the empty-patterns dead branch), `archetypes.yaml:required_signals`, `archetypes.yaml:company_filter.*`, `low_match` (referenced in classifier but not in scoring lens), the company-signal hard-nos (no JD will ever match them).
- **P2-2: Tighten industry hard-no matching.** Switch from `body.includes(industry)` to either `role.industry === industry` (structured) OR a word-boundary regex to avoid the "weapons-grade encryption" false-positive surface. No current hits, but the surface is there.
- **P2-3: Make soft-pref / anti-signal patterns config-driven.** `SOFT_PREF_PATTERNS` and `ANTI_SIGNAL_PATTERNS` live in `scoring-layer.mjs:347-373`. Users add a new preference only by editing code today.
- **P2-4: `hybrid_nyc_area` (config exists, 0 emissions in corpus).** Either (a) verify the city-normalization in `scan-jobs.mjs` routes Brooklyn/Hoboken/JC properly OR (b) drop the bucket. As-is the +8 incentive is silent.
- **P2-5: `soft:diverse_leadership` (0 emissions).** Patterns are very narrow ("diverse leadership", "underrepresented", "female-led"). Either broaden, or remove.

---

## Cross-references

- `docs/audits/2026-05-18-comp-trust-gate-rescore.md` — the trust gate's own audit, contains the 12 drift records and the Anaconda 10/10 callout.
- `scripts/audit-comp-trust-gate.mjs` — re-runs `adjustScore` against the corpus; useful for any post-fix re-score.
- `reports/backfill-locations-2026-05-13.md` — the May-13 location backfill that populated `location_region` and exposed the `"ca"` → Canada bug post-hoc.
