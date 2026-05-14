# Coverage Engine — Path B Overhaul (2026-05-14)

This document captures what shipped in branch `feat/coverage-engine-overhaul` and
how to operate it. Companion to `autoapply/SCRAPER_AUDIT.md` (the empirical
justification) and `autoapply/SOURCE_PRIORITY.md` (the priority data the audit
was built on).

The overhaul transforms the CareerOps scraper from a 39-hardcoded-company system
into a self-expanding coverage engine: BuiltIn and YC discoveries can auto-promote
into direct ATS tracking, Lever is a first-class handler, the bleeding wounds
(revopscareers enrichment waste, Tier 5 social futility) are closed, and the
classification-array drift across six files is gone.

## What changed (7 tasks across 7 commits)

| Task | Commit | Theme |
|---|---|---|
| 1 | 59299a0 | Dedupe `AGGREGATOR_HOSTS` / `EXCLUDE_DOMAINS` into a canonical JSON config + Node/TS loaders. |
| 2 | fbd056c | Structured `companies.yml` schema with per-entry source / added_date / paused / notes. Hand-rolled YAML reader, no js-yaml dep. |
| 3 | c3fc8a2 | Auto-promotion engine — crown jewel. `ats-slug-extractor.mjs` + `promote-company.mjs` + `review-promotions.mjs` CLI. |
| 4 | d2678c6 | Lever ATS handler. Seeded Plaid, PostHog, Pinecone, Modal Labs. |
| 5 | 08fb532 | Y Combinator direct crawler (`workatastartup.com` hydration JSON). |
| 6 | 583c256 | Killed two bleeding wounds: enrich-roles now respects quarantine; Tier 5 social gated behind env flag. |
| 7 | 443a55a | End-to-end fixture integration tests. |

Pre-Path-B baseline tests: 125 (root) + 14 (dashboard-web). Post-Path-B: **283 root + 14 dashboard-web**, lint clean, build green. **+158 net tests.**

## New schema for `config/companies.yml`

```yaml
companies:
  - canonical_name: EliseAI            # human-readable, ≤100 chars
    ats: ashby                         # ashby | greenhouse | lever
    slug: eliseai                      # lowercase [a-z0-9_-], required
    source: manual                     # manual | manual_confirmed | auto_promoted_from_<channel>
    added_date: 2026-05-12             # YYYY-MM-DD
    notes: "Series B AI-native NYC"    # optional
    last_seen_active: 2026-05-13       # optional, scraper-populated
    paused: false                      # optional — excludes from per-ATS scrape but stays in file
    needs_slug_verification: false     # optional — flag for slugs we're unsure about
```

Schema validation: `scripts/lib/companies-schema.mjs` (`validateCompanyEntry`,
`validateCompaniesList`, `hasEntry`, `SUPPORTED_ATS`, `KNOWN_SOURCES`).

Reader/writer: `scripts/lib/companies-load.mjs` (`parseCompaniesYaml`,
`serializeCompaniesYaml`, `readCompaniesFile`, `writeCompaniesFile`,
`loadCompaniesGrouped`). Atomic writes (temp + rename). Deterministic field order
for stable git diffs.

`scan-jobs.mjs` reads via `loadCompaniesGrouped()`; returns
`{ ashby: string[], greenhouse: string[], lever: string[], all: CompanyEntry[] }`.
Paused entries are excluded from the per-ATS slug arrays but included in `all`.

## Auto-promotion behavior

**Trigger:** when the pipeline surfaces a role whose URL is a recognized ATS
endpoint (`jobs.ashbyhq.com/<slug>`, `boards.greenhouse.io/<slug>`,
`jobs.lever.co/<slug>`, …) AND the discovery channel is a promotable aggregator
(`BuiltIn`, `Tier 1: YC`, `Tier 6: Similar` when a BuiltIn-seeded), the slug is
appended to `companies.yml` so the next scan run gets Tier-1 ATS depth on that
company.

**Safety:**
- Per-run cap: `PROMOTION_CAP_PER_RUN = 20`. If a run would promote a 21st, it's
  capped — a warning prints and further candidates are skipped.
- Fit-score floor (default 4): if the role has an enriched fit score, it must be
  ≥ 4. Pre-enrichment promotions in scan-jobs.mjs use floor 0 (we don't know fit
  yet) — see "Open work" below for promoting at enrichment time instead.
- Atomic write to `config/companies.yml` (temp + rename).
- Dedup against existing (ats, slug) pairs — including same slug across different
  ATS (Hebbia is on both Ashby as `hebbia-ai` AND Greenhouse as `hebbia`).

**Daily log:** every promotion writes one JSON object to
`data/auto-promotions/<YYYY-MM-DD>.jsonl`:
```json
{"ts":"2026-05-14T07:42:13Z","ats":"ashby","slug":"vanta","canonical_name":"Vanta","source_url":"https://jobs.ashbyhq.com/vanta/xyz","found_via":"builtin"}
```

**Manual review:**
```sh
node scripts/review-promotions.mjs              # list all auto-promoted entries
node scripts/review-promotions.mjs --days 7     # last 7 days
node scripts/review-promotions.mjs --confirm <ats>/<slug>   # flip to manual_confirmed
node scripts/review-promotions.mjs --pause   <ats>/<slug>   # paused: true (skip next scan)
node scripts/review-promotions.mjs --remove  <ats>/<slug>   # delete the entry
```

## New ATS handlers

### Lever (`scripts/lib/lever-scraper.mjs`)
- Public API: `https://api.lever.co/v0/postings/<slug>?mode=json`
- No auth required.
- Wired into `scan-jobs.mjs` as a new Tier 1 step right after Greenhouse.
- Seeded with 4 companies (source: `manual`, added_date 2026-05-14):
  - `plaid` — fintech infrastructure
  - `posthog` — product analytics
  - `pinecone` — vector DB (notes: verify if 404)
  - `modal-labs` — serverless compute for AI/ML
- Not seeded (slug unverified): vercel, anthropic, notion. Add manually once
  confirmed — or let auto-promotion catch them when they surface via BuiltIn.

### Y Combinator direct (`scripts/lib/yc-scraper.mjs`)
- Target: `https://www.workatastartup.com/jobs`
- Strategy: HTML fetch + extract embedded `<script id="__NEXT_DATA__">` hydration
  JSON + walk for postings arrays. Falls back to `server_data` script tag if YC
  refactors. Returns `[]` gracefully on parse failure.
- Wired into `scan-jobs.mjs` as a Tier 1.5 step between Greenhouse and Lever.
- Uses the existing `YC_SEARCHES` keyword list (`"GTM Engineer"`, `"Revenue
  Operations"`, `"RevOps"`, `"Go-to-Market"`) — same source of truth as the
  legacy Tier-10 Exa-keyword YC path.
- Source tag: `"Tier 1: YC"`. Captures YC-specific extras (`ycBatch`, `ycStage`)
  in normalized output.

The legacy Tier-10 Exa-keyword YC path remains in place; URL-level dedup catches
overlap. Once the direct path is verified in production, the legacy Tier-10 can
be removed (flagged in commit message for follow-up).

## Killed wounds

### Wound A: revopscareers no longer enriches
**Before:** 248 revopscareers URLs/month enriched by Claude, 0 high-fit, 0
applied. Pure token waste.

**After:** `scripts/enrich-roles.mjs` `main()` imports `isAggregatorHost` and
`isExcludedHost` from `scripts/lib/source-classification.mjs` and skips
matching URLs at the top of the `toEnrich` loop. Console prints:
```
Skipped quarantined sources: 248, spam-blocked: 17 (saved Claude API calls)
```

This also catches spam-blocked hosts (`liveblog365`, `wuaze`, `saashero`, …)
that were technically being excluded at Exa-scan time but still made it into
seen-urls.json via Tier 6 Similar leaks.

### Wound B: Tier 5 social signals gated
**Before:** 3 Exa queries × 2 runs/day × 30 days = 180 queries/month for 7 URLs
cumulative, 0 high-fit.

**After:** `scripts/scan-jobs.mjs` Tier 5 block is gated behind
`ENABLE_SOCIAL_SIGNALS=true`. Default off. Re-enable per-run with:
```sh
ENABLE_SOCIAL_SIGNALS=true npm run scan-jobs
```
SOCIAL_QUERIES array stays in source so the experiment is reproducible.

## How to test without live scrape

The full pipeline is fixture-tested. To run everything:
```sh
export PATH=/opt/homebrew/opt/node@25/bin:$PATH
npm test                                           # root: 283 tests
cd dashboard-web && npm test                       # 14 tests
cd dashboard-web && npm run build                  # Next.js production build
cd dashboard-web && npm run lint                   # eslint
```

To run only the new path-B integration tests:
```sh
node --test scripts/lib/path-b-integration.test.mjs
```

Fixtures live in `tests/fixtures/path-b-integration/`:
- `sample-builtin-roles.json`     — 10 BuiltIn-surfaced roles
- `sample-yc-roles.json`          — YC `__NEXT_DATA__` hydration payload
- `sample-lever-response.json`    — Lever API responses for 3 companies
- `sample-quarantined-source.json` — seen-urls.json entries for gate testing

To smoke-test the review CLI without any promotions yet:
```sh
node scripts/review-promotions.mjs
```

## What morning-Nick should verify

1. **Run scan-jobs.mjs locally**, watch the auto-promotion logs:
   ```sh
   export PATH=/opt/homebrew/opt/node@25/bin:$PATH
   npm run scan-jobs 2>&1 | tee /tmp/scan-jobs-first-run.log
   ```
   Look for lines like `AUTO-PROMOTED: <name> → <ats>/<slug> (from <host>)`.

2. **Review auto-promoted entries** before letting them accrue:
   ```sh
   node scripts/review-promotions.mjs
   ```
   For each entry, decide:
   - Looks legit and matches ICP → `--confirm` it (flips source to `manual_confirmed`).
   - Off-target → `--remove` it. Consider whether to add a denylist.

3. **Spot-check** 2-3 promoted companies — confirm their Ashby / Greenhouse /
   Lever URLs actually resolve (`curl -sI <url>` returns 200 or 301-to-200).

4. **Verify Lever tier ran cleanly:** scan output should show
   `[Tier 1] Lever API — 4 companies` and `Found N matching roles (0 404s, …)`.
   If 404s appear, the slug needs correction in `config/companies.yml` (use
   `needs_slug_verification: true` while debugging).

5. **Verify YC direct tier:** if it errors ("no-hydration" in failed list), YC
   has likely refactored their stack again. The legacy Tier-10 Exa-keyword path
   will still cover YC in the meantime; file an issue to update the parser.

6. **Confirm enrichment skips quarantined hosts:**
   ```sh
   npm run enrich 2>&1 | head -20
   ```
   Look for the `Skipped quarantined sources: N` line. N should match the count
   of revopscareers etc. URLs in seen-urls.json from the latest scan.

## Open work (post-Path B)

These items came out of the build but are deliberately out of scope:

1. **BuiltIn → ATS redirect resolution at enrichment time.** Today's auto-promotion
   only fires when a discovered URL is *already* an ATS URL (Tier 6 Similar
   surfacing, etc.). The audit's textbook "BuiltIn page → Ashby apply form" case
   requires fetching each individual JD to capture the apply URL. The cleanest hook:
   add a `processRolePromotion` call into `scripts/enrich-roles.mjs` after JD
   fetch, using the resolved apply URL as the trigger.
   [Estimated: 1-2 hours; sharply increases promotion yield.]

2. **`companies.yml` could move to JSON.** Programmatic mutation is easier in
   JSON; the auto-promotion engine wouldn't need its hand-rolled YAML serializer.
   But YAML is more human-friendly for inline notes. Defer until pain.

3. **"Auto-confirm after N successful enrichments" rule.** Today auto-promoted
   entries stay `source: auto_promoted_from_<channel>` until a human runs
   `--confirm`. A rule like "auto-flip to `manual_confirmed` if last-7d
   enrichments yielded ≥ 1 fit-≥-6 role" would close the manual-review loop.

4. **Legacy Tier-10 (Exa-keyword YC) deprecation.** Now that Tier 1.5 YC direct
   exists, the Tier-10 Exa-keyword variant duplicates effort. Remove once the
   direct path's reliability is confirmed over 7+ days of production runs.

5. **Generalize the VC-board crawler.** Per audit §7 quick-win #5 / medium-term
   #3: 5 hardcoded VC boards in `VC_BOARD_CONFIGS` could become a single
   YAML-config-driven Getro/Consider parser. Touches Tier 11; affects scope.

6. **`config/companies.yml` Vercel / Anthropic / Notion seeds.** Slugs need
   verification before seeding (per spec). Add via `--confirm` once an
   auto-promotion or manual check confirms.

7. **AGGREGATOR_HOSTS / EXCLUDE_DOMAINS — single source of truth confirmed in
   tests.** The new `config/source-classification.json` is the canonical home,
   loaded by Node and TS sides. If a 7th file ever duplicates the arrays again,
   `scripts/lib/source-classification.test.mjs` will not catch it directly — add
   a CI grep for the literal strings if drift recurs.

## Related docs

- `autoapply/SCRAPER_AUDIT.md` — the empirical audit that motivated all 7 tasks
- `autoapply/SOURCE_PRIORITY.md` — the priority data feeding the audit
- `scripts/lib/source-classification.mjs` — canonical AGGREGATOR_HOSTS / EXCLUDE_DOMAINS
- `scripts/lib/companies-schema.mjs` — schema validation
- `scripts/lib/promote-company.mjs` — auto-promotion engine
- `scripts/review-promotions.mjs` — manual-review CLI
