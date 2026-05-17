# Backend Data Audit — CareerOps Polish v1

**Date:** 2026-05-17
**Branch:** feat/polish-1
**Purpose:** Verify polish-spec-required data exists before UI build

## Summary

- 8 fields audited
- 5 classified as **(a) ALREADY PRODUCED**
- 2 classified as **(b-S)** S-effort additions (under 1 hour each)
- 1 classified as **(b-S)** for the specific investigation task (perf profiling, not data production)
- 0 fields require M+ effort — **no patterns need to be cut from this round**

## Per-field findings

### Field 1: `score_breakdown: [{driver, weight, value}]` per role

- **Used by:** Pattern 2 (score reasoning surfacing), Pattern 5 (full breakdown in list payload — cut from this round)
- **Status:** **(a) ALREADY PRODUCED**
- **Source today:** `scripts/lib/scoring-layer.mjs:56-116` — the `adjustScore()` function returns `{ adjusted_score, score_base, adjustments: [{source, delta, reason}], disqualified, disqualification_reason }`. Each adjustment has `source` (e.g., `location:hybrid_nyc`, `comp:below_floor`, `archetype:gtm-engineering`), `delta` (numeric points on 0-100 scale), and `reason` (human-readable).
- **Stored at:** `data/enrichments.json` — per-URL entries include `score_adjustments` array (identical shape to `adjustments`), `score_base`, `score_adjusted`, `score_disqualified`, `score_disqualification_reason`. Verified in sample entry (Rillet): 3 adjustments with source/delta/reason.
- **Shape today vs. needed:** The spec calls it `score_breakdown: [{driver, weight, value}]`. The actual shape is `score_adjustments: [{source, delta, reason}]`. The mapping is direct: `driver` = `source`, `weight` = `delta` (on 0-100 scale, divide by 10 for display), `value` = `reason`. No transformation needed beyond field renaming.
- **Dashboard consumption today:** The dashboard (`dashboard-web/lib/data.ts`, `dashboard-web/lib/company-detail.ts`) reads `score_adjusted` and `score_base` but does NOT currently surface `score_adjustments`. The data is in the JSON; the UI just doesn't read it yet.
- **Effort to surface:** S — read the existing `score_adjustments` array from enrichments.json and pass it through to the UI component. No new computation.
- **Recommendation:** Proceed in T1. Data exists; wiring it to UI is straightforward.

### Field 2: `archetype_match_score` per role (numeric, per archetype)

- **Used by:** Pattern 2 (archetype display layer), Pattern 7 (universal archetype display — cut)
- **Status:** **(a) ALREADY PRODUCED**
- **Source today:** `scripts/lib/archetype-classifier.mjs:46-118` — `classifyArchetype()` returns `{ primary, confidence, secondary, reasoning, classified_at, needs_review, stage }`. The `reasoning` field contains per-archetype fitness scores as a string: e.g., `"rules: gtm-engineering=0.35, ai-operations=0.14, fde=0, web3-bd=0, web3-bizops=0"`.
- **Stored at:** `data/enrichments.json` — per-URL entries include `archetype_primary`, `archetype_confidence` (0-1 float), `archetype_secondary` (array), `archetype_reasoning` (the string above), `archetype_classified_at`, `archetype_needs_review`.
- **Shape today vs. needed:** The spec wants a numeric match score per archetype per role. The primary archetype's score is `archetype_confidence`. For all archetypes, the full breakdown is embedded in `archetype_reasoning` as a parseable string (`"rules: id=score, id=score, ..."`). The internal `scoreAllArchetypes()` function (line 120-176) produces `[{id, raw_score, fitness, breakdown}]` but only the primary's `fitness` is stored as `archetype_confidence`.
- **Dashboard consumption today:** `/context` page already reads `archetype_primary`, `archetype_confidence`, `archetype_secondary`, `archetype_reasoning`, `archetype_needs_review` and renders them in the ReviewQueuePanel and ArchetypeCard components.
- **Effort to get per-archetype scores:** S — either parse the `archetype_reasoning` string (regex: `(\w[\w-]*)=([\d.]+)`) or, for a cleaner solution, store the full `scoreAllArchetypes` result array in enrichments.json during enrichment. Parsing the string is zero-effort for display; storing the array requires a small enrichment script change.
- **Recommendation:** Proceed in T1. Parse the reasoning string for display — it's reliable and already stored. Full array storage can be a future enhancement.

### Field 3: `signal_metadata` (per signal: source, timestamp, context)

- **Used by:** Pattern 8 (/signals expandable detail — T1-3)
- **Status:** **(a) ALREADY PRODUCED** (partial — sufficient for T1-3)
- **Source today:** `data/signal-seen.json` stores per-slug: `{ name, amount, lastChecked, result }`. The enrichment layer (`dashboard-web/lib/signal-enrichment.ts`) adds `match: { archetypes_matched, archetype_roles_count, total_roles, hiring_velocity, has_pipeline_roles, match_status }` via the company-archetype-matcher.
- **Shape today vs. needed:** The spec wants "source, triggered_at, related_company, related_roles, dismiss action" in the expanded panel. What exists:
  - `name` + `slug` → company identity (source of the signal)
  - `amount` → funding amount (the signal trigger)
  - `lastChecked` → when last verified (approximate `triggered_at`)
  - `match.archetypes_matched` + `match.archetype_roles_count` → related roles count
  - Dismiss action already exists (implemented in signals-client.tsx via `/api/signals/dismiss`)
  - **Missing:** individual related role titles/URLs (need to join with seen-urls.json by company slug) and the actual signal source (Crunchbase, press, etc.)
- **Effort to add related roles:** S — the company-aggregator already resolves all roles per company slug. Can reuse `aggregateCompany(slug).roles` to get the role list. Signal source is not tracked (always Crunchbase-derived in practice).
- **Recommendation:** Proceed in T1-3. Related roles available via existing aggregator; signal source can be labeled "Funding signal" generically. No new data production needed.

### Field 4: `hidden_roles` log (which roles hidden, when, with what reason)

- **Used by:** Pattern 4 (Hidden filter — T1-5), Pattern 10 (hide-with-reason — already shipped partial)
- **Status:** **(b-S) REQUIRES NEW COMPUTATION — S effort**
- **Source today:** No persistent hidden-roles log exists. The current hide/dismiss mechanisms are:
  - **Signal-level dismiss:** `user-context.yaml:excluded_companies` (permanent, company-wide, loaded by `dashboard-web/lib/signal-enrichment.ts:66-81`)
  - **JD quality filter:** `data/enrichments.json` entries with `enrichment_quality: "rejected_*"` — shown in `/context` Filtered tab
  - **Pipeline status:** `data/applications.md` `SKIP` and `Discarded` statuses
  - **No per-role hide-with-reason** — there's no `data/hidden-roles.json` or equivalent
- **Shape today vs. needed:** T1-5 needs a filter showing "roles the user explicitly hid with a reason." T1-4 (bulk triage) also writes to this. Currently the only hide mechanism is `mark_skipped` status in the pipeline, which doesn't carry a reason.
- **Effort to add:**
  - Create `data/hidden-roles.json` keyed by URL: `{ reason_code, note, hidden_at }`
  - Add a POST `/api/pipeline/hide` endpoint that writes to this file
  - Wire the filter to read from this file in `getRoles()`
  - Total: S (under 1 hour)
- **Recommendation:** Include as T0 backend prep work. This is the one genuinely new data structure T1 depends on.

### Field 5: `recent_scan_timestamp` (last successful scan run)

- **Used by:** Pattern 6 (/today freshness)
- **Status:** **(a) ALREADY PRODUCED**
- **Source today:**
  - `data/events/YYYY-MM-DD.jsonl` — event log with `scrape.tier_start` / `scrape.tier_complete` entries including `ts` (ISO timestamp). Most recent scan at `data/events/2026-05-17.jsonl`.
  - `data/briefings/last-regen-daily.json` — `{ kind: "daily", at: "2026-05-14T14:37:28.485Z" }` for last briefing generation.
  - `dashboard-web/lib/data.ts:499-510` — `lastScanDate` derived from report filenames (`reports/job-scan-YYYY-MM-DD.md`). Already surfaced in pipeline header.
- **Shape today vs. needed:** Already available. `lastScanDate` shows in the pipeline header. The /today page inherits it via `getStats()`. The event log provides precise timestamps if needed.
- **Effort to add:** None — already surfaced.
- **Recommendation:** Proceed. No changes needed.

### Field 6: `archetype_definitions` with weights (display-ready for /context)

- **Used by:** Pattern 1 (/context dead-end fix — T1-1), Pattern 8
- **Status:** **(a) ALREADY PRODUCED** — and already rendered
- **Source today:** `config/archetypes.yaml` — full definitions with `id`, `name`, `description`, `maturity`, `resume`, `required_signals`, `reward_signals` (with keywords + weights), `title_signals`, `company_filter`, `institutional_companies_boost`.
- **Dashboard consumption today:** `/context` page (`app/context/page.tsx:56`) already loads archetypes via `loadArchetypeConfig()` and passes the full array to `ContextPageClient`. The `ArchetypeCard` component renders each archetype with role counts from `archetypeCounts`. The `PreferencesPanel` renders user-context.yaml preferences. The `ReviewQueuePanel` shows roles needing review. The `RecentEventsPanel` shows recent events. The `FilteredPanel` shows quality-rejected roles.
- **Critical finding:** The spec's T1-1 describes building `/context` from scratch — but **/context already exists with 6 tabbed sections** (Archetypes, Preferences, Resumes, Review queue, Filtered, Recent events). It is NOT a blank dead-end today. The PersonaLab synthetic personas may have encountered it in a state where data was empty (no enriched roles = empty review queue, no events = empty events tab), but the route and components are implemented.
- **Recommendation:** T1-1 should be **reframed from "build /context" to "fix empty-state rendering + add missing data actions."** The components exist; the issue is likely (a) data population for the test personas' context, and/or (b) missing `data-action` attributes that the QA runner uses to detect affordances.

### Field 7: `dashboard_perf_metrics` (page load time for /today)

- **Used by:** Pattern 9 (slow load — T0-2)
- **Status:** **(b-S) NO EXISTING INSTRUMENTATION — but not needed for fix**
- **Source today:** No performance instrumentation exists in the dashboard. The `/analytics` route tracks pipeline analytics (archetype distribution, scoring trends), not page performance. No Web Vitals, no load time measurement, no performance.mark() calls.
- **Shape today vs. needed:** T0-2 needs to fix /today load time, not instrument it permanently. The acceptance criterion is "first paint under 2s measured by browser performance API" — this is a one-time profiling task, not a data-production requirement.
- **Root cause hypothesis:** `/today/page.tsx` calls `getRoles({ includeAggregator: true })` which reads and parses `data/seen-urls.json` + `data/enrichments.json` + `data/score-overrides.json` + applications.md + reports directory. This is the same heavy path /pipeline uses. For /today, only the briefing + stats are needed — most of the role data is unused except for `computePipelineStats()`.
- **Effort to profile + fix:** S-M (1-3 hours). Profile with browser DevTools. Likely fix: slim down the server-side data fetch for /today to only what stats + briefing need, skip the full `getRoles` enrichment join.
- **Recommendation:** Proceed in T0-2. No data audit concern — this is a performance engineering task.

### Field 8: `/companies/[slug]` data shape (for C6 duplicate-key bug fix)

- **Used by:** T0-1 (React duplicate-key fix)
- **Status:** **(a) ALREADY PRODUCED** — and the bug source is identifiable
- **Source today:** `scripts/lib/company-aggregator.mjs:153-155` generates role IDs via `roleIdFromUrl(url) = Buffer.from(url).toString("base64").slice(0, 12)`. This 12-char base64 truncation can produce collisions for URLs that share a long common prefix.
- **Rendering in UI:** `company-detail-client.tsx:310` uses `key={r.id}` for roles (potentially colliding). Line 176 uses `key={id}` for archetype chips (safe — unique archetype IDs). Lines 439 and 467 use `key={it.key}` and `key={String(it.value)}` for summary items (safe if flags are deduplicated).
- **Also confirmed:** Nested `<a>` bug on /signals: `signals-client.tsx:173-201` wraps each signal card in a `<Link>` (renders as `<a>`) with a nested `<Link>` at line 183-189 for the company name. This is invalid HTML (`<a>` inside `<a>`) causing hydration errors. Same pattern repeats for "Warming Up" section at lines 215-238.
- **Effort to fix:**
  - Duplicate keys: use full URL hash or the URL itself as key instead of truncated base64. S effort.
  - Nested `<a>`: restructure signal cards to use a `<div>` as outer container with `onClick` navigation, keeping only the inner company name as a `<Link>`. S effort.
  - `key={idx}` in MorningBriefing.tsx:175 and ExpandedRow.tsx:66,79 and PipelineTable.tsx:228 — these use index keys for lists that may reorder. Low risk but worth noting.
- **Recommendation:** Proceed in T0-1. Bug sources are identified; fixes are mechanical.

---

## Spec adjustments needed

### Patterns to proceed as written
- **T0-1** (duplicate-key fix) — sources identified, fixes clear
- **T0-2** (/today perf) — root cause hypothesis formed, profiling needed
- **T1-2** (/today click-through) — briefing items already have `action_href` and `context`; the expandable panel wires into existing data
- **T1-3** (/signals expandable detail) — signal metadata sufficient; related roles available via aggregator
- **T1-4** (bulk triage) — depends on T1-5's hidden roles log; otherwise uses existing pipeline actions
- **T1-5** (hidden roles filter) — depends on new `data/hidden-roles.json` (see T0 prep below)

### Patterns to REFRAME (not cut, but spec language is wrong)
- **T1-1** (/context dead-end): The spec describes building `/context` from scratch with `<ProfilePanel />`, `<ArchetypeListPanel />`, `<ScoringHistoryPanel />`. **In reality, /context already exists** with 6 tabbed sections: Archetypes (with ArchetypeCard), Preferences (PreferencesPanel), Resumes (ResumesPanel), Review queue (ReviewQueuePanel), Filtered (FilteredPanel), Recent events (RecentEventsPanel). The real fix is:
  1. Ensure `data-action` attributes are present so PersonaLab QA runner detects affordances (currently missing)
  2. Improve empty-state rendering when data is sparse
  3. Possibly add score_adjustments display to the existing ArchetypeCard or a new section
  4. **Do NOT rebuild from scratch** — the components work; the QA system couldn't detect them

### Patterns to cut from this round entirely
- None — all fields are either (a) already produced or (b-S) easy additions

### Backend prep work to include in T0
1. **Create `data/hidden-roles.json`** — empty `{}` initial file + document schema: `{ [url]: { reason_code: string, note?: string, hidden_at: string } }`. This unblocks T1-4 and T1-5.
2. **Add `data-action` attributes to /context components** — the page renders content but the QA runner can't see affordances without these attributes. This is a T0-level fix because it affects the success criteria measurement.

---

## Open questions for user

1. **T1-1 scope revision:** The /context route is already built and functional (6 tabs, archetype cards, preferences, review queue, events, filtered roles). The PersonaLab finding of "dead-end with zero affordances" likely reflects missing `data-action` attributes rather than a blank page. Should T1-1 be rescoped to "add data-actions + fix sparse empty states" rather than "build three new panels"? This dramatically reduces effort (from M 3-5h to S 1-2h).

2. **"378 duplicate-key errors" source:** The QA reports consistently say "20+ duplicate-key warnings per page." The spec's "378" number isn't in the QA data. Where did this number come from? It changes the scope — 20 warnings suggests a single list rendering bug; 378 suggests something systemic.

3. **Nested `<a>` on /signals:** This is a known bug (confirmed in code at signals-client.tsx:173-189 — Link nested inside Link). It's not in the spec's T0 items but is cited by 6/6 personas as a hydration error source. Should it be added to T0-1's scope?
