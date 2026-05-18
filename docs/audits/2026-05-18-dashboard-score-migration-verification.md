# Dashboard score-migration verification (Wave 3 — E3)

**PR branch:** `fix/dashboard-reads-score-adjusted`
**Captured:** 2026-05-18
**Method:** `dashboard-web/scripts/snapshot-roles.mts` run against the live
`data/enrichments.json` + `data/seen-urls.json` + reports + applications, on
both `main` (BEFORE) and the new chain (AFTER).

## TL;DR

- 1,062 of 1,265 surfaced roles (84%) come from enriched paths. All 1,062 of
  them carry `score_adjusted` — i.e., none fall through to the
  `enriched_base_only` or `enriched_raw_claude` fallback branches in the live
  dataset. The fallbacks exist for data-quality safety, not because today's
  data needs them.
- The "previously clipped at 7" cohort is real and now displays correctly.
  Every role in the AFTER /pipeline top-10 carries an engine score that was
  visibly held back before (base 7→adj 10, base 8→adj 10).
- A small number of roles get *lower* engine-adjusted scores than their raw
  Claude fit (e.g. Solv 9 → 1; Fireworks AI 6 → 1). That is the engine
  correctly applying comp/location penalties; the AFTER state shows them as
  the engine intends. This is the part of the diff most worth eyeballing.

## Provenance distribution

| Provenance | BEFORE | AFTER |
|---|---:|---:|
| `enriched` | 1062 | 1062 |
| `enriched_base_only` | 0 | 0 |
| `enriched_raw_claude` | 0 | 0 |
| `heuristic` | 184 | 184 |
| `application` | 3 | 3 |
| `override` | 16 | 16 |
| **Total** | **1265** | **1265** |

Note: the `enriched_*` fallback branches are unused in today's data because
the engine has been re-run end-to-end. The fallback chain exists so that any
historical enrichment record missing `score_adjusted` or `score_base` still
renders rather than silently disappearing.

## Top 10 — `/pipeline` (score ≥ 4, not closed, not rejected/skipped)

### BEFORE

| # | Score | Company | Title | Provenance |
|---|---:|---|---|---|
| 1 | 9 | Rillet | GTM Operations Lead | override |
| 2 | 9 | Rillet | GTM Engineer | override |
| 3 | 9 | Supabase | GTM Compensation Lead | override |
| 4 | 9 | Mento | GTM Engineer | enriched |
| 5 | 9 | DailyRemote | AI GTM Engineer | enriched |
| 6 | 9 | Clockwork Systems | Revenue Operations Lead / GTM Engineer | enriched |
| 7 | 9 | Anthropic | Underprompt — GTM Engineer | enriched |
| 8 | 9 | Anthropic | GTM Engineer | enriched |
| 9 | 9 | Taktile | GTM Engineer | enriched |
| 10 | 9 | Proton.AI | Founding GTM Engineer | enriched |

### AFTER

| # | Score | Company | Title | Provenance | base→adj |
|---|---:|---|---|---|---|
| 1 | 10 | Scribe | GTM Engineer | enriched | 7→10 |
| 2 | 10 | Toast | GTM Engineer, Marketing Operations / AI Innovation | enriched | 7→10 |
| 3 | 10 | DISQO | GTM Engineer | enriched | 7→10 |
| 4 | 10 | Playground | GTM Engineer | enriched | 8→10 |
| 5 | 10 | Kontakt.io | RevOps Engineer | enriched | 7→10 |
| 6 | 10 | Redis | Experienced GTM Engineer | enriched | 8→10 |
| 7 | 10 | FOSSA | GTM Engineer | enriched | 7→10 |
| 8 | 10 | PointOne | GTM Engineer | enriched | 8→10 |
| 9 | 10 | Mento | GTM Engineer | enriched | 9→10 |
| 10 | 10 | Anaconda | GTM Engineer | enriched | 8→10 |

The new top 10 is composed entirely of roles whose engine `score_adjusted`
exceeded what the dashboard previously displayed. Before the fix, the
displayed score was either Claude's raw verdict (capped or uncapped) or the
heuristic cap of 7 — never the engine's true output.

## Top 10 — `/today` (no filter)

### BEFORE

| # | Score | Company | Title | Provenance |
|---|---:|---|---|---|
| 1 | 9 | Rillet | GTM Operations Lead | override |
| 2 | 9 | Supabase | GTM Engineer | override |
| 3 | 9 | Rillet | GTM Engineer | override |
| 4 | 9 | Supabase | GTM Compensation Lead | override |
| 5 | 9 | Rula | GTM Engineer (Remote) | enriched |
| 6 | 9 | Mento | GTM Engineer | enriched |
| 7 | 9 | Stuut | GTM Engineer | override |
| 8 | 9 | DailyRemote | AI GTM Engineer | enriched |
| 9 | 9 | Clockwork Systems | Revenue Operations Lead / GTM Engineer | enriched |
| 10 | 9 | Anthropic | Underprompt — GTM Engineer | enriched |

### AFTER

| # | Score | Company | Title | Provenance | base→adj |
|---|---:|---|---|---|---|
| 1 | 10 | Scribe | GTM Engineer | enriched | 7→10 |
| 2 | 10 | Aven | GTM Engineer, Sales | enriched | 7→9.5 |
| 3 | 10 | Togal-AI | GTM Engineer | enriched | 8→10 |
| 4 | 10 | Toast | GTM Engineer, Marketing Operations / AI Innovation | enriched | 7→10 |
| 5 | 10 | DISQO | GTM Engineer | enriched | 7→10 |
| 6 | 10 | Rula | GTM Engineer (Remote) | enriched | 9→10 |
| 7 | 10 | Playground | GTM Engineer | enriched | 8→10 |
| 8 | 10 | Kontakt.io | RevOps Engineer | enriched | 7→10 |
| 9 | 10 | Redis | Experienced GTM Engineer | enriched | 8→10 |
| 10 | 10 | Riverside.fm | GTM Engineer | enriched | 8→10 |

## Top 10 — `/companies` (by rolesFound, then by top role score)

### BEFORE

| # | Company | Roles | Top Score | Top Title |
|---|---|---:|---:|---|
| 1 | Unknown | 28 | 7 | Senior Revenue Operations Manager |
| 2 | EliseAI | 8 | 8 | GTM Engineer |
| 3 | Gong | 8 | 6 | Director, GTM Automations & Data |
| 4 | Anthropic | 7 | 9 | GTM Engineer |
| 5 | Hirevector | 7 | 1 | Revenue Operations Analyst |
| 6 | Fullcast | 6 | 1 | Sales Tech Stack: Build a Revenue Command Center |
| 7 | ServiceNow | 5 | 3 | Sr. Partner GTM Operations Manager |
| 8 | Zip | 5 | 8 | GTM Engineer |
| 9 | Go | 4 | 8 | Go-to-Market Engineer — Patch |
| 10 | Jobflarely | 4 | 7 | Director RevOps Architect |

### AFTER

| # | Company | Roles | Top Score | Top Title |
|---|---|---:|---:|---|
| 1 | Unknown | 28 | 7 | Senior Revenue Operations Manager |
| 2 | EliseAI | 8 | 9 | VP of Revenue Operations |
| 3 | Gong | 8 | 3 | Director, GTM Automations & Data |
| 4 | Anthropic | 7 | 7 | GTM Strategy & Operations, Enterprise Business Partner |
| 5 | Hirevector | 7 | 3 | GTM Engineer (Growth & Revenue Automation) |
| 6 | Fullcast | 6 | 3 | Revenue Operations Specialist: 2026 Job Description Guide |
| 7 | ServiceNow | 5 | 5 | Sr. Partner GTM Operations Manager |
| 8 | Zip | 5 | 8 | GTM Engineer |
| 9 | Go | 4 | 10 | Go-to-Market Engineer — Intradiem |
| 10 | Jobflarely | 4 | 7 | Director RevOps Architect |

For each company the displayed "top role" is the highest-scored role in the
group; when individual role scores shift, the headline role of the company
can change. EliseAI's headline now reads its VP of Revenue Operations
posting (base 6, adj 8.5 → 9) rather than its GTM Engineer (which dropped
in the engine pass).

## `/companies/anaconda` drilldown

### BEFORE

| # | Score | Company | Title | Provenance |
|---|---:|---|---|---|
| 1 | 8 | Anaconda | GTM Engineer | enriched |

### AFTER

| # | Score | Company | Title | Provenance | base→adj |
|---|---:|---|---|---|---|
| 1 | 10 | Anaconda | GTM Engineer | enriched | 8→10 |

Note: the drilldown table (`company-detail-client.tsx`) already read
`score_adjusted` directly from the company-aggregator pipeline — so this
already displayed `10/10` *in the drilldown table itself* before this PR.
What this PR fixes is the **list view** of `/companies` (which reads
`role.score` from `getRoles()`), the **pipeline view**, and the **today
stat strip**. Pre-PR, those surfaces showed Anaconda as 8/10. Post-PR they
agree with the drilldown at 10/10. The dashboard is now internally
consistent.

## Named-record verification (vs spec expectations)

| Record (URL) | BEFORE | AFTER | Expected | Notes |
|---|---:|---:|---:|---|
| Anaconda GTM Engineer (`builtin.com/job/.../8843434`) | 8 | 10 | 10 | ✅ engine 8 → 10 |
| OpenAI Product Engineer, GTM Innovation (`builtin.com/job/.../7239792`) | 7 | 1 | 1 | ✅ fit=7, adj=1 (comp/location penalty) |
| Introhive Head of GTM Enablement (`ventureloop.com/...2994893`) | 3 | 0 | 0 | ✅ fit=3, adj=0 (disqualified) |
| Databricks Sr Analytics Engineer (`builtin.com/.../8891593`) | 6 | 0 | 0 | ✅ fit=6, adj=0 (disqualified) |
| **"Enable"** | — | — | 0 | ⚠️ No company named "Enable" in the corpus — only "Revenue **Enablement**" titles. Spec target likely meant a specific posting; without a URL this record can't be definitively pinned. The Wayflyer Senior Manager, Revenue Enablement posting (`revopscareers.com/job/wayflyer-senior-manager-revenue-enablement-dublin-ireland`) has fit=4, adj=0 — that pattern matches the "Expected 0" intent. |
| **"Built In Boston"** | — | — | 0 | ⚠️ "Built In Boston" is a *source*, not a company. The closest single record is EliseAI VP of Revenue Operations on `builtinboston.com/...6266810`, which has no enrichment (heuristic path → displays 7). The spec target is likely the unenriched listing on Built In Boston; this displays as 7/heuristic, not 0. **Possible spec oversight** — flagged for reviewer. |

### California-fix winners

| Record | BEFORE | AFTER | engine fit / adj | Interpretation |
|---|---:|---:|---|---|
| Snowflake Director Sales Operations GTM Planning | 4 | 8 | fit=4, adj=7.5 | ✅ pure California-fix lift; comp floor was already passing |
| Sift Stack GTM Engineer | 8 | 8 | fit=8, adj=8 | unchanged (already at engine score; the role's adjustments net to zero) |
| xAI Head of GTM, Systems & Agents | 8 | 8 | fit=8, adj=8 | unchanged for the same reason |
| Replit Director RevOps Architect | 4 | 4 | fit=4, adj=3.5 (rounds to 4) | net-zero after rounding |
| You.com Head of Revenue Operations | 7 | 3 | fit=7, adj=3 | comp + location adjustments dropped it; *not* the California-fix path |
| VibeCodeCareers GTM Engineer | 6 | 2 | fit=6, adj=2 | comp/location penalties applied |
| Fireworks AI GTM Operations Manager (Sara's List) | 6 | 1 | fit=6, adj=0.9 | comp/location penalties applied |
| Solv GTM Engineer | 9 | 1 | fit=9, adj=0.5 | the most dramatic single-role shift in the named set — the engine disqualified or heavily-penalized this role despite Claude's high fit |
| Eve | — | — | — | ⚠️ no company "Eve" in the corpus (`findByPattern("eve ")` collides with "EliseAI" via the unguarded substring fallback before this lookup tightened) |

**Interpretation:** the spec framed the California-fix winners as roles that
"should display their post-fix improved scores." That holds for one
unambiguous case (Snowflake). For the rest, the new dashboard surfaces a
fuller picture: the California-region fix isn't the only adjustment the
engine applies — comp-floor and other penalties stack on top. The AFTER
column is the score the engine actually computed; the BEFORE column was
Claude's raw verdict with the heuristic cap-at-7 then applied. **The PR is
not changing what the engine thinks — only what the dashboard reads.** If
the AFTER number disagrees with intuition for a specific role, the
discussion belongs in scoring-layer / archetype-config, not in the read
layer.

## Data quality findings

- Total enrichment records (raw, including `{error, timestamp}` entries):
  **1,332**
- Real enrichment records (no `error`): **1,127**
- Records with `score_adjusted`: **1,125 / 1,127 = 99.8%**
- Records with `score_base`: **1,125 / 1,127 = 99.8%**
- Records with `fit_score`: **1,125 / 1,127 = 99.8%**
- Records where `score_adjusted ≠ fit_score`: **1,081 / 1,125 = 96.1%**

The fallback chain (`enriched_base_only`, `enriched_raw_claude`) handles the
~0.2% gap gracefully. No `enriched_*` fallback is exercised in the live
dataset today.

The 96.1% mismatch between `score_adjusted` and `fit_score` is the engine
G4 layer doing its job. Pre-PR, the dashboard ignored that for every one of
those records.

## Risks for reviewer

1. **Many roles will appear to drop.** Solv 9 → 1, Fireworks AI 6 → 1,
   You.com 7 → 3, etc. None of this is the dashboard losing data — it's
   the dashboard finally surfacing the engine's adjusted output. If any
   of those AFTER scores feel wrong, the conversation belongs upstream
   (scoring-layer config, archetype keywords).
2. **The displayed top of `/pipeline` and `/today` is now a wall of 10s.**
   That's because the previously-displayed scores in those slots were
   either heuristic-capped or raw Claude — never the engine. The AFTER
   list is roughly *which roles does the engine like most*. This is the
   right behavior but a noticeable visual change.
3. **Two records in the spec's named-check list could not be unambiguously
   resolved** (Enable, Built In Boston). The supplied descriptors map to
   classes of records rather than single roles — flagging this so the
   reviewer can either (a) pin specific URLs, or (b) accept the closest
   matches reported above.

## Follow-ups (NOT acted on in this PR)

- `dashboard-web/components/MorningBriefing.tsx:242` reads `context.fit_score`
  from a server-generated briefing JSON. The schema is owned by
  `scripts/generate-briefing.mjs` (out of scope for this dashboard-only PR).
  That display field shows "Score: {fit}/10" — it should likely show
  `score_adjusted` when available. Requires a parallel migration on the
  briefing generator.
- `dashboard-web/app/context/_components/PreferencesPanel.tsx:30` carries
  the label "Location preferences (point deltas applied to fit_score × 10)".
  Technically accurate — `fit_score` *is* the engine's input — but a
  reader who only knows the dashboard's surfaces will probably read this
  as "the score you see on `/pipeline`." Worth a wording pass in a future
  copy-polish PR.
