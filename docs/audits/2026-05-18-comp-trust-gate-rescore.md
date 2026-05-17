# Comp Trust Gate — Re-Score Impact (Dry Run)

**Date:** 2026-05-18
**Branch:** `fix/comp-trust-gate`
**Mode:** dry-run — no writes to `data/enrichments.json`
**Trigger:** 2026-05-17 audit of missed Anaconda GTM Engineer role (`builtin.com/job/gtm-engineer/8843434`)

## Cohort counts

| Cohort | Count |
|---|---|
| Total enriched roles with archetype | 1077 |
| Had `comp:below_floor` penalty applied (any source) | 481 |
| ↳ of those, `comp_source == jsonld_basesalary` | 272 |
| ↳ of those, Claude contradiction → gate fires | 53 |

## Score impact

> ⚠️ **Drift caveat.** Re-running `adjustScore` against the current scoring code/config exposes records whose persisted `score_adjusted` was computed with older code/config. Those drift-induced changes happen even with the trust gate disabled and are **not caused by this PR** — but the live re-score will write them back. The table below splits gate-attributable changes from drift-attributable ones so the PR's actual surface area is visible.

| Metric | Value |
|---|---|
| Total roles with `score_adjusted` change | 63 |
| ↳ attributed to **the trust gate (this PR)** | 51 |
| ↳ attributed to **background drift (pre-existing)** | 12 |
| Roles whose score INCREASED | 52 |
| Roles whose score DECREASED | 11 |
| Mean delta (all) | 2.66 |
| Median delta (all) | 4.00 |
| Max delta | 5.00 |
| Min delta | -9.30 |

### Delta distribution (|Δ| bins)

| Bin | Count |
|---|---|
| 0–0.5 | 1 |
| 0.5–1 | 1 |
| 1–2 | 8 |
| 2–3 | 5 |
| 3–4 | 10 |
| 4–5 | 15 |
| 5+ | 23 |

## Anaconda — the audit-trigger role

- **URL:** `https://builtin.com/job/gtm-engineer/8843434`
- **Title / company:** GTM Engineer @ Anaconda
- **Old `score_adjusted`:** 6
- **New `score_adjusted`:** 10
- **Delta:** +4
- **Suppression reason:** comp_source=jsonld_basesalary but Claude reports no comp listed in verdict+red_flags

**Old adjustments:**
  - `location:fully_remote` Δ 5 — remote
  - `comp:below_floor` Δ -50 — min $101,500 < floor $200,000
  - `archetype:gtm-engineering` Δ 25 — lens raw=30 cap=25 mult=1

**New adjustments:**
  - `location:fully_remote` Δ 5 — remote
  - `comp:below_floor_suppressed` Δ 0 — comp_source=jsonld_basesalary but Claude reports no comp listed in verdict+red_flags
  - `archetype:gtm-engineering` Δ 25 — lens raw=30 cap=25 mult=1

## Top 20 score_adjusted increases (ranked by delta)

| # | Company | Title | Old | New | Δ | Comp scraped | Why |
|---|---|---|---|---|---|---|---|
| 1 | Toast | Gtm Engineer Marketing Operations Ai Innovation | 5 | 10 | +5 | $124,000 – $198,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 2 | NMI | Revenue Operations Manager Business Applications | 1.8 | 6.8 | +5 | $100,000 – $115,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in verdict |
| 3 | Go | Go-To-Market (GTM) Engineer - Evertune | 2.5 | 7.5 | +5 | $80,000 – $100,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 4 | Box | Go to Market Sales Operations Analyst | 1.5 | 6.5 | +5 | $76,500 – $95,500 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 5 | FOSSA | GTM Engineer - FOSSA - Built In | 5 | 10 | +5 | $135,000 – $165,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 6 | Go | Go-to-Market Engineer - Patch | 1.3 | 6.3 | +5 | $150,000 – $185,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 7 | demandDrive | GTM Engineer | 2 | 7 | +5 | $110,000 – $120,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in verdict+red_flags |
| 8 | Sent | RevOps Engineer | 3.5 | 8.5 | +5 | $120,000 – $170,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in verdict+red_flags |
| 9 | Go | Go-to-Market Engineer - Patch | 1.5 | 6.5 | +5 | $150,000 – $185,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in verdict+red_flags |
| 10 | LangChain | GTM Engineer | 1 | 6 | +5 | $160,000 – $180,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 11 | Thoughtly | GTM Engineer | 4.5 | 9.5 | +5 | $120,000 – $160,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 12 | Sift Stack | GTM Engineer | 0.5 | 5.5 | +5 | $140,000 – $180,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 13 | Snorkel AI | Senior GTM Engineer | 5 | 10 | +5 | $160,000 – $240,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 14 | Flex | Revenue Operations Manager - Systems | 3 | 8 | +5 | $115,600 – $170,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 15 | PointClickCare | (US) Revenue Enablement Systems Associate | 0 | 5 | +5 | $75,300 – $83,700 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in verdict+red_flags |
| 16 | incident.io | Head of GTM Systems & Applied AI | 2.5 | 7.5 | +5 | $175,000 – $225,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 17 | DigiCert | Lead GTM Analytics Engineer | 3.8 | 8.8 | +5 | $160,000 – $170,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 18 | Team 201 | Director, Marketing Operations & GTM Engineer | 2 | 7 | +5 | $120,000 – $150,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 19 | Built In Boston | GTM Engineer, Marketing Operations AI Innovation - | 4 | 9 | +5 | $124,000 – $198,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |
| 20 | Toast | Senior GTM Engineer, AI Innovation | 4 | 9 | +5 | $115,000 – $184,000 /yr | comp_source=jsonld_basesalary but Claude reports no comp listed in red_flags |

## Score decreases — all from background drift

These records decrease in score, which would be unexpected if caused by the gate (the gate only ever suppresses penalties, never adds them). Verified: each row's drift baseline equals the new score, meaning the change is entirely from re-running today's scoring code/config against historically-scored roles. The gate fired on none of these.

| Company | Title | Old | New | Δ | Source of change |
|---|---|---|---|---|---|
| Talos — New York \| SailOnchain | GTM Engineer at Talos — New York \| SailOnchain | 5.1 | 4.4 | -0.7 | drift |
| Talos | GTM Engineer | 6.8 | 5.5 | -1.3 | drift |
| Built In Boston | GTM Engineer: Data Infrastructure & AI Intelligenc | 3.5 | 0 | -3.5 | drift |
| Enable | Director of Revenue Operations | 4.9 | 0 | -4.9 | drift |
| Insight Partners | Sr. Analyst GTM Strategy & Operations | 4.5 | 3.1 | -1.4 | drift |
| Paytm | Enterprise GTM Lead, Inference and Agentic AI | 4 | 1.5 | -2.5 | drift |
| Databricks | Sr Analytics Engineer - GTM Strategy and Operation | 3.5 | 0 | -3.5 | drift |
| OpenAI | Product Engineer, GTM Innovation | 9.3 | 0 | -9.3 | drift |
| Skydio | Senior Revenue Operations Manager | 1.5 | 0 | -1.5 | drift |
| Jobs | GTM Operations Lead @ Gumloop - Jobs | 9.8 | 7.8 | -2 | drift |
| Introhive | Introhive hiring Head of GTM Enablement in Toronto | 5 | 0 | -5 | drift |

## Other drift-attributed changes (increases not from this PR)

| Company | Title | Old | New | Δ | Why (best guess) |
|---|---|---|---|---|---|
| Hirebase | Revenue Operations Manager \| Hirebase | 5.1 | 5.4 | +0.3 | code/config drift |

## Methodology notes

- Loaded `data/enrichments.json` (1,122 enriched roles) and `data/seen-urls.json`.
- For each role with `fit_score` and `archetype_primary`, re-ran `adjustScore` with new gate logic.
- Compared the new `adjusted_score` against the persisted `score_adjusted` (last re-scored 2026-05-17 02:00 UTC, pre-fix).
- Roles whose pre-fix `score_adjusted` was missing (never re-scored) are skipped — they show as "no change" but actually go from undefined → new score on the live re-score.
- No writes to `data/enrichments.json` in this run.

## How to read this report

- **Gate firing** (`comp:below_floor_suppressed` emitted) should equal the # of records whose old penalty got suppressed. If the score delta count > gate-firing count, something else moved (unexpected).
- **Delta should be +5** for a "pure suppression" case (the -50 penalty going away translates to +5 on the 0–10 display scale, modulo clamping).
- **Larger deltas** (e.g. +6, +7) happen when the role was previously dragged to a clamp at the low end and is now free to rise to base+archetype.

## Note — Anaconda 10/10 smell (Phase 1.5 candidate)

Post-fix, Anaconda clamps to 10/10. This is mathematically correct (base 8 × 10 + 5 remote + 25 gtm-eng archetype = 110 → clamped 100 → 10). However, a perfect score on a role whose comp data is tagged `comp:below_floor_suppressed` is a smell. Future enhancement (Phase 1.5): when the `comp:below_floor_suppressed` tag is present, cap the final score at something like 8.5 or 9 to reflect that the role hasn't passed full evaluation. Out of scope for this PR.
