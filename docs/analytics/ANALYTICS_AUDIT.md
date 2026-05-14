# Analytics Audit — observability gaps in the CareerOps scraper

**Created:** 2026-05-14
**Purpose:** Inventory what we already see, what we capture but discard, and what we don't track — to ground the design of the new `/analytics` surface.

> **Note on location.** This doc lives under `docs/analytics/` rather than `autoapply/` because Terminal 3 / Path B currently owns the `autoapply/` namespace. The two audit docs (`autoapply/SCRAPER_AUDIT.md`, `autoapply/SOURCE_PRIORITY.md`) cover the *scraper* itself; this doc covers *observability* of that scraper.

---

## 1. Currently captured (persisted to disk)

These are the durable artifacts the scraper / enricher / dashboard already write. Everything our analytics can compute today, it computes by reading these files.

| File | Shape | Update frequency | Captured dimensions |
|---|---|---|---|
| `data/seen-urls.json` | `{ [url]: { firstSeen, title, source, company, location, closed?, closedDate? } }` | Every scan-jobs run, appended | Per-URL: discovery timestamp, sourcing tier tag (`source` field), host derivable from URL, role title at discovery, closed-flag |
| `data/enrichments.json` | `{ [url]: { fit_score, comp_range, location_class, ..., timestamp } \| { error, timestamp } }` | Every enrich-roles run, appended | Per-URL: fit_score (1–9), comp_range, location class, scrape error events with timestamp, qualitative signals |
| `data/applications.md` | Markdown table | Manual + merge-tracker | Per-application: company, role, status, score, date — used for application-attribution cross-ref |
| `data/pipeline.md` | Markdown URL list | scan-jobs append | Pending URL inbox (no analytics signal) |
| `data/briefings/YYYY-MM-DD.md` | Generated briefing markdown | Daily | Snapshot of pipeline state at briefing time |
| `data/score-overrides.json` | `{ [url]: { override_score, override_note } }` | Manual edits | Score-feedback signal (used by sync-score-feedback) |

**Implicit / computed:**
- **Source health** is computed at request-time by `dashboard-web/lib/source-health.ts:computeSourceHealth()`. It joins seen-urls + enrichments and emits per-host: `totalUrls, enrichedReal, scrapeFailures, enrichmentRate, scrapeErrorRate, avgFit, maxFit, hitRate (fit≥6), hasCompCoverage, recoverableCount, projectedCompCoverage, lastSeen, status, auditFinding, sourceTags`. It is NOT persisted — the `/sources` page recomputes on every load.

**What this means for analytics today:**
We can already compute per-host, all-time aggregates of *discovery volume* and *enrichment fit*. We cannot compute *cost*, *latency*, *retry counts*, *dedup decisions*, *filter rejections*, *tier durations*, or *anomaly events* — those signals are produced and then thrown away.

---

## 2. Captured but not surfaced (console-logged, in-memory `stats`, or response-discarded)

These signals are *generated* during a scrape/enrich run but persist only in console output or in the per-run `stats` markdown report; the next run overwrites them.

| Where | Signal | What we do with it now | What we lose |
|---|---|---|---|
| `scripts/scan-jobs.mjs:1141` | `stats = { ashby, greenhouse, exa, vc, hn, gtmClub, revopsCoop, social, similar, intent, deep, builtin, yc, vcBoards, google }` accumulator | `generateReport(roles, stats)` writes a one-shot markdown report; `stats` is then GC'd | Per-tier discovery counts, retry counts, 404 lists — never trended across days |
| `scripts/scan-jobs.mjs:1132` | `console.log("[Tier N] …")` calls in `main()` | Stdout only | Real-time visibility into which tier hung or how long it took — never persisted |
| `scripts/scan-jobs.mjs:618` (`scanAshby`), `:674` (`scanGreenhouse`) | Per-company HTTP 404s captured in `stats.ashby.failed[]` / `stats.greenhouse.failed[]` | Logged once in the run report | Trend: is a tracked company's slug going stale? |
| `scripts/scan-jobs.mjs:722–873` (Exa wrappers) | Each Exa call returns a JSON body with `costDollars` field (Exa's official cost tracking) | Discarded — only `.results[]` is read | **Every Exa call's cost is in the response and we throw it away.** Direct $$ lift possible by retaining it. |
| `scripts/scan-jobs.mjs:1065` (`scanBuiltIn`) | HTTP status codes, retry-after headers, redirect chains | None captured | WAF blocks, 429s, redirects, parse failures — no per-source extractor health |
| `scripts/enrich-roles.mjs:442` (Claude call) | Response body includes `usage.input_tokens`, `usage.output_tokens`, `model`, latency | We read `content[0].text` and parse JSON; usage metadata is discarded | **Every Claude call's token usage is in the response and we throw it away.** Direct cost-tracking lift possible. |
| `scripts/enrich-roles.mjs` Exa lookups | Same as scan-jobs Exa wrappers — `costDollars` discarded | — | Same as above |
| Title-matcher rejections (`titleMatchesPositive`, `titleMatchesNegative`, `titleHasRoleToken`) | Implicit | None | Why a candidate URL was filtered out — never recorded |
| Dedup decisions (`normalizeUrl` + `seenUrls` lookup) | Implicit | None | "Already seen" skips happen silently — we don't know how many or why (same URL? same title? same content hash?) |
| Quarantine bypass (`AGGREGATOR_HOSTS` quarantined in `source-health.ts` but **still enriched** by scan-jobs/enrich-roles) | The bug `SCRAPER_AUDIT.md` §7 flags | None | We can't see in real time that revopscareers.com is still burning Claude tokens |

---

## 3. Not captured at all

These signals don't exist anywhere in the system today. They are the new instrumentation surface.

| Signal | Why it matters |
|---|---|
| **Per-HTTP-request:** host, method, status, duration_ms, retry_count, error_class | Diagnose extractor regressions (sudden 403 spikes), per-host cooldown effectiveness |
| **Per-Claude-call:** input_tokens, output_tokens, cost_usd, model, duration_ms, role_url | Enables cost-per-quality-lead KPI; surfaces token waste on quarantined sources |
| **Per-Exa-call:** query, query_type (search/findSimilar/deepSearch), num_results, costDollars, duration_ms | Enables cost-per-tier KPI; surfaces tier 5 social waste (180 queries/mo, 0 hits) |
| **Per-tier:** start_ts, end_ts, duration_ms, exit_status, roles_discovered, roles_after_dedup, roles_after_filter | Detect a tier that hasn't run in N days; trend tier-level efficiency |
| **Dedup events:** `{ url, kind: 'seen_url' \| 'similar_title_company', reason }` | Diagnose why the funnel narrows; spot dedup that's *too* aggressive (kills legitimate variants) |
| **Filter rejections:** `{ url, title, company, reason: 'negative_token' \| 'no_role_token' \| 'non_job_url' \| ... }` | Funnel section; expose what the ICP filter is rejecting (and whether it's right) |
| **Auto-promote candidate / applied:** `{ slug, ats, source_url, decision }` (Path B compat) | Surface auto-promotions in real time |
| **Anomaly events:** synthesized at rollup time | High-cost-low-yield, extractor-regression, quarantine-still-enriched, source-not-heard-from |
| **Scoring breakdown:** which `autoScore()` signals fired and their contributions | Explain why a given role got X points — useful for tuning |

---

## 4. Recommendations (ranked by ROI)

ROI = (impact on diagnostic / cost-control) × (1 / implementation cost). Top of list = build first.

### 1. **Claude token + cost capture** ⭐⭐⭐
- **Add where:** `scripts/enrich-roles.mjs:442` (after `await res.json()`)
- **Cost to add:** 5 lines (read `body.usage.input_tokens`, `output_tokens`; compute cost via model-rate lookup; emit `enrich.claude_call` event)
- **Expected insight:** Daily Claude spend, cost-per-fit-≥6 role, cost-per-application, ability to see at-a-glance that revopscareers.com is burning $0.40/day on quarantined enrichments

### 2. **Exa cost capture** ⭐⭐⭐
- **Add where:** Each of the 5 Exa wrappers in `scripts/scan-jobs.mjs:722–873` (also `enrich-roles.mjs:169`)
- **Cost to add:** 1 line per call site (`body.costDollars` from response; emit `scrape.exa_call` event)
- **Expected insight:** Per-tier Exa spend; cost-per-tier ROI table — confirms or refutes Tier 5 / Tier 7 / Tier 3 are wasting budget per the existing audit

### 3. **Per-tier duration + exit status** ⭐⭐
- **Add where:** Around each `[Tier N]` block in `scripts/scan-jobs.mjs:main()`
- **Cost to add:** A `tierTimer()` helper that wraps each tier and emits `scrape.tier_start` + `scrape.tier_complete`
- **Expected insight:** Identify the slowest tier; detect when a tier silently fails or hasn't run in days

### 4. **HTTP request instrumentation** ⭐⭐
- **Add where:** Replace direct `fetch()` calls with a `loggedFetch()` wrapper
- **Cost to add:** ~20 minutes if done as a wrapper module; we'd need to swap call sites — moderate effort. Risk: we don't want to refactor 1,725 LoC of scraper tonight. Compromise: only instrument the *top-level* fetch from each tier helper, not every URL.
- **Expected insight:** Per-host error rates over time; WAF detection; retry effectiveness
- **Decision:** Build the wrapper, ship it in `scripts/lib/scan-jobs-instrumentation.mjs`, but DO NOT wire it into `scan-jobs.mjs` tonight (Terminal 3 is editing that file concurrently — see WORK_LOG_ANALYTICS.md). Wiring is a 5-line morning-merge task.

### 5. **Dedup + filter-rejection events** ⭐⭐
- **Add where:** Inside `titleMatchesPositive`/`titleMatchesNegative` and the seen-urls dedup check
- **Cost to add:** Light — one `logEvent()` call per branch
- **Expected insight:** Funnel section of the dashboard; identify titles the ICP filter rejected (was that right?)

### 6. **Anomaly synthesis at rollup time** ⭐⭐
- **Add where:** End of `scripts/generate-analytics-rollup.mjs`
- **Cost to add:** Self-contained — does not touch scraper
- **Expected insight:** Surface the revopscareers-still-being-enriched bug; tier-not-run; extractor regression

### 7. **Auto-promote events (Path B coordination)** ⭐
- **Add where:** Path B's promotion logic (Terminal 3 writes `scripts/lib/promote-company.mjs`)
- **Cost to add:** Wait for Path B; analytics surface it when `data/auto-promotions/*.json` exists
- **Expected insight:** Auto-promotion log section of dashboard; flag if >20 promotions/day (runaway)

### 8. **Per-host backoff visibility** ⭐
- **Add where:** `scripts/lib/host-cooldown.mjs` already exists — emit events when cooldown triggers
- **Cost to add:** Tiny if the lib exposes hooks
- **Expected insight:** "WAF cooled" / "rate limited" events visible per host

### 9. **Scoring breakdown** ⭐
- **Add where:** `scripts/scan-jobs.mjs:autoScore()`
- **Cost to add:** Moderate — refactor to return both score and a breakdown object
- **Expected insight:** "Why did this role score N points?" — useful for tuning the scorer
- **Decision:** Defer. Not in tonight's scope.

### 10. **Per-tier roles-discovered vs roles-after-filter** ⭐
- **Add where:** Counts already implicitly exist; just emit events at filter boundaries
- **Cost to add:** Tiny once event-log infra is in
- **Expected insight:** Funnel attribution at tier × stage granularity

---

## 5. Scope decision for tonight

This audit informs Tasks 2–8. Concretely:

- **Task 2 (event-log infra)** implements the taxonomy in §3 plus a `DISABLE_EVENT_LOG` no-op flag.
- **Task 2 also ships `scripts/lib/scan-jobs-instrumentation.mjs`** with `tierTimer()`, `loggedFetch()`, `claudeUsageHook()`, and `exaCostHook()` helpers — but does NOT modify `scan-jobs.mjs` itself (Terminal 3 collision).
- **Task 3 (rollup)** computes the §3 dimensions from event logs *if present* and degrades gracefully when not.
- **Task 4 (backfill)** reconstructs §1's available signals for the last 60 days from existing files; everything else is `null` in the historical rollups.
- **Tasks 5–8** consume the rollups and build the surfaces.

**Out of scope tonight:** scoring breakdown (#9), per-host backoff event emission (#8 — needs host-cooldown.mjs edit).

**Morning-merge task:** Wire `scripts/lib/scan-jobs-instrumentation.mjs` into `scripts/scan-jobs.mjs` and `scripts/enrich-roles.mjs` (a 10-line, 5-call-site edit each). Documented in WORK_LOG_ANALYTICS.md.

---

## 6. Files this audit was derived from

- `~/projects/job-search/nick-career-ops/autoapply/SCRAPER_AUDIT.md` (Path B's audit)
- `~/projects/job-search/nick-career-ops/autoapply/SOURCE_PRIORITY.md` (Path B's source priority analysis)
- `dashboard-web/lib/source-health.ts` (existing health classifier, 437 LoC)
- `scripts/scan-jobs.mjs` (main scraper, 1,725 LoC, 12 tiers, hardcoded `stats` taxonomy at line 1141)
- `scripts/enrich-roles.mjs` (enricher, 796 LoC, calls Claude at line 442 with sonnet-4 model)
- `data/seen-urls.json` + `data/enrichments.json` (the persistent state we can backfill from)
