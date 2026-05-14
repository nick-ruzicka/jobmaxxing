# Scraper Analytics — operating manual

**Created:** 2026-05-14
**Branch (overnight build):** `feat/scraper-analytics`
**See also:** [`ANALYTICS_AUDIT.md`](./ANALYTICS_AUDIT.md) for the audit that motivated this layer.

## What this is

A self-contained observability layer over the CareerOps scraping and
enrichment pipeline. It tells us:

- **What's working** — per-source hit rates, daily fit≥6 / fit≥7 yields, application attribution
- **What's broken** — extractor regressions, source-silent crawlers, scrape error trends
- **What's wasting tokens** — quarantined sources still being enriched, low-yield tiers
- **What's worth investing in** — cost-per-quality-lead trend; which sources punch above their weight

Built in one night on top of the existing scraper. No instrumentation in
`scan-jobs.mjs` itself yet — that wires in at morning-merge time via the
standalone wrapper module (see [§ Wiring instrumentation](#wiring-instrumentation)).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  scripts/scan-jobs.mjs     scripts/enrich-roles.mjs                         │
│       │                          │                                          │
│       ▼ (post-wiring)            ▼ (post-wiring)                            │
│  scripts/lib/scan-jobs-instrumentation.mjs                                  │
│       │  ├── tierTimer / loggedFetch / recordExaCall / recordClaudeCall     │
│       │                                                                     │
│       ▼ logEvent({type, ...})                                               │
│  scripts/lib/event-log.mjs ──► data/events/YYYY-MM-DD.jsonl                 │
│                                          │                                  │
│                                          ▼                                  │
│  scripts/generate-analytics-rollup.mjs ──► data/analytics/daily/YYYY-MM-DD.json │
│  scripts/backfill-analytics-from-state.mjs                                  │
│                                                                             │
│                                          │ (consumed by ↓)                  │
│  dashboard-web/app/api/analytics/* ──► dashboard-web/app/analytics/*        │
│  scripts/analytics-cli.mjs                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files map

| Layer | Module | Role |
|---|---|---|
| Event log | `scripts/lib/event-log.mjs` | Append-only JSONL writer, taxonomy enforcement, batched + unbuffered modes |
| Instrumentation | `scripts/lib/scan-jobs-instrumentation.mjs` | Wrappers ready to drop into scan-jobs / enrich-roles |
| Rollup | `scripts/generate-analytics-rollup.mjs` | Daily rollup CLI |
| Rollup logic | `scripts/lib/analytics-rollup.mjs` | Pure aggregation; reused by tests |
| Backfill | `scripts/backfill-analytics-from-state.mjs` | Reconstructs rollups for pre-event-log dates |
| Dashboard data | `dashboard-web/lib/analytics.ts` | Server-side aggregation across rollups |
| Dashboard detail | `dashboard-web/lib/source-detail.ts` | Per-host deep-dive aggregation |
| API | `dashboard-web/app/api/analytics/route.ts` | Main aggregate endpoint |
| API | `dashboard-web/app/api/analytics/anomalies/route.ts` | Active anomalies |
| API | `dashboard-web/app/api/analytics/cost/route.ts` | Cost breakdown |
| API | `dashboard-web/app/api/analytics/source/[source]/route.ts` | Per-host detail |
| Dashboard | `dashboard-web/app/analytics/page.tsx` | 8-section overview |
| Dashboard | `dashboard-web/app/analytics/[source]/page.tsx` | Per-host deep-dive |
| CLI | `scripts/analytics-cli.mjs` | Terminal-first inspector |

## Daily workflow

1. **Scraper runs** (cron or manual): `npm run scan-jobs` → writes to `data/seen-urls.json` + emits events to `data/events/`.
2. **Enrichment runs**: `npm run enrich` → writes to `data/enrichments.json` + emits Claude usage events.
3. **Rollup runs**: `npm run analytics:rollup` → aggregates `data/events/{date}.jsonl` into `data/analytics/daily/{date}.json` with anomaly detection.
4. **Dashboard reads** the rollups via `/api/analytics`.
5. **CLI reads** the rollups via `node scripts/analytics-cli.mjs`.

### One-time setup (already done in this branch)

```bash
# Reconstruct historical rollups from existing state files
node scripts/backfill-analytics-from-state.mjs --days 60
```

### Recommended cron addition

Add the rollup as a post-scrape step. For example:

```cron
# crontab -e
0 9,17 * * *  cd /path/to/career-ops && npm run scan-jobs && npm run enrich && npm run analytics:rollup
```

## Wiring instrumentation

`scripts/lib/scan-jobs-instrumentation.mjs` exists but is **not yet imported** by `scan-jobs.mjs` or `enrich-roles.mjs` — the standalone module shipped intentionally on this branch so Path B (Terminal 3) could keep editing `scan-jobs.mjs` concurrently without conflict.

After the Path B merge lands, wire the helpers in:

### `scripts/scan-jobs.mjs`

```js
// At the top of the file:
import {
  tierTimer,
  recordExaCall,
  flushEvents,
} from "./lib/scan-jobs-instrumentation.mjs";

// Wrap each tier block in main():
const ashbyResults = await tierTimer("tier_1_ashby", async () =>
  scanAshby(companies.ashby),
);

// After each Exa wrapper:
const body = await res.json();
recordExaCall(body, { query_type: "search", query, tier: "tier_2_broad" });

// Before exit:
flushEvents();
```

### `scripts/enrich-roles.mjs`

```js
import {
  recordClaudeCall,
  recordEnrichmentResult,
  flushEvents,
} from "./lib/scan-jobs-instrumentation.mjs";

// After the Anthropic fetch (line ~442 today):
const claudeBody = await res.json();
recordClaudeCall(claudeBody, {
  url,
  model: "claude-sonnet-4-20250514",
  duration_ms: Date.now() - claudeStartedAt,
});

// After enrichment completes (or errors):
recordEnrichmentResult({ url, host, fit_score: analysis.fit_score });

// Before exit:
flushEvents();
```

**Roughly 10 lines total** across both files. The instrumentation is fail-safe: every `logEvent()` call is wrapped in try/catch so logging never crashes the scraper.

## Key files (runtime)

| Path | Contents | Retention | Tracked? |
|---|---|---|---|
| `data/events/YYYY-MM-DD.jsonl` | One event per line (see event-log taxonomy) | 90 days (rotate manually) | gitignored |
| `data/analytics/daily/YYYY-MM-DD.json` | Pre-computed daily rollup | 1 year+ (small files) | gitignored |
| `data/auto-promotions/YYYY-MM-DD.json` | Path B output if Path B ships | n/a | gitignored |

## How to add new metrics

1. **Add event type** to the taxonomy in `scripts/lib/event-log.mjs` (`EVENT_TYPES` Set).
2. **Emit the event** wherever the signal is generated. Wrap in try/catch to be safe.
3. **Add aggregation** in `scripts/lib/analytics-rollup.mjs:computeRollup()` (handle the new `e.type` case).
4. **Surface in the rollup schema** — add a new field to `totals`, `by_source`, or `by_tier`.
5. **Add to TypeScript types** in `dashboard-web/lib/analytics.ts` (`SourceBucket`, `TierBucket`, etc.).
6. **Render** in `dashboard-web/app/analytics/sections.tsx` or the CLI in `scripts/analytics-cli.mjs`.
7. **Document** the metric and its meaning here.

## Anomaly types

| Type | Triggered when | Suggested action |
|---|---|---|
| `high_cost_low_yield` | Source spent >$0.10 with 0 fit≥6 across ≥5 enrichments today | Quarantine the source or tighten its ICP filter |
| `extractor_regression` | Source's hit rate dropped >30% vs the prior 7-day average (≥3 prior days of data) | Inspect the per-source extractor for HTML structure change |
| `quarantined_still_enriched` | A `claude_call` was attributed to a host in `AGGREGATOR_HOSTS` | Add a pre-enrichment quarantine check (don't call Claude on these) |
| `source_silent` | Source produced ≥5 roles in prior days but 0 today | Crawler may be silently broken; check tier_complete event for `exit_status` |
| `auto_promotion_explosion` | `auto_promotions` total >20 in one day | Review companies.yml diff; promotion logic may be runaway |

## What's NOT tracked yet (deferred)

From the [Task 1 audit](./ANALYTICS_AUDIT.md):

- **Per-host backoff visibility** — `host-cooldown.mjs` doesn't emit events when cooldown triggers. Easy add once we touch that module.
- **Scoring breakdown** — `autoScore()` returns only the final number; the per-signal contribution isn't surfaced. Would help tune scoring weights but requires a refactor.
- **Per-tier × per-stage funnel** — events are tier-tagged in the wrapper but the per-stage drop-off (discovered → after-dedup → after-filter) isn't sliced per tier. The data is there; the UI section just doesn't render it.
- **Live tail of events** — there's no WebSocket / SSE stream of events. The dashboard auto-refreshes every 5 minutes. Real-time view would be ideal but is out of tonight's scope.

Future-work items go in this list as TODOs.

## Operational gotchas

- **`data/events/` and `data/analytics/` are gitignored.** Don't commit them; they're per-machine runtime state.
- **`DISABLE_EVENT_LOG=true`** makes all logging a no-op. Useful when running tests or batches where disk writes are unwelcome.
- **Backfill rollups** carry `data_completeness: "reconstructed"`. The dashboard surfaces a "historical" badge so you know not to trust cost numbers from those days (they're synthesized).
- **The rollup generator never overwrites a `full` rollup with a `reconstructed` one** — if you re-run backfill after the event log has accumulated, your real data is safe.
- **Cost figures use list pricing** from `scripts/lib/scan-jobs-instrumentation.mjs:CLAUDE_PRICING`. If your invoice differs, adjust the table there or compute cost from the actual response body if Anthropic surfaces it.

## Tests

- `scripts/lib/event-log.test.mjs` — 15 tests
- `scripts/lib/scan-jobs-instrumentation.test.mjs` — 5 tests
- `scripts/lib/analytics-rollup.test.mjs` — 15 tests
- `dashboard-web/lib/analytics.test.ts` — 10 vitest tests
- `dashboard-web/lib/source-detail.test.ts` — 6 vitest tests

Run all: `npm test` (root) + `cd dashboard-web && npm test`.
