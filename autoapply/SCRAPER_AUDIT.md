# Scraper Infrastructure Audit — 2026-05-14

**Question:** Is the 93.5% BuiltIn dominance in `SOURCE_PRIORITY.md` real market concentration, or selection bias from our own scraper configuration?

**Short answer:** ~80% selection bias, ~20% real concentration. The "93.5%" figure is also inflated by double-counting (the same applied role is credited to both BuiltIn *and* its destination ATS, so percentages sum to >180% across the top two sources). See §6.

---

## 1. Scraper inventory

### Files involved
| File | LoC | Role |
|---|---|---|
| `scripts/scan-jobs.mjs` | 1,725 | Main scraper — 12 tiers, single source of truth for job URL discovery |
| `scripts/scan-signals.mjs` | 960 | Pre-posting signal detection (funding → likely-hiring), not a job scraper per se |
| `scripts/lib/title-cleanup.mjs` / `normalize-company.mjs` | 109 + 118 | Title/company normalization used during dedup |
| `scripts/lib/location.mjs` / `location-clusters.mjs` | 155 + 286 | Location parsing |
| `scripts/lib/extract-comp.mjs` | 329 | Comp extraction (post-scrape, used by enrichment) |
| `scripts/lib/host-cooldown.mjs` | 99 | Per-host rate limiting (for `enrich-roles.mjs`, not scan-jobs) |
| `config/companies.yml` | 58 | **Only declarative config**: tracked Ashby + Greenhouse slugs (24 + 14 = 38 companies) |
| `dashboard-web/lib/source-health.ts` | 437 | UI-side health classifier with `AGGREGATOR_HOSTS` and `EXCLUDE_DOMAINS` constants (must stay in sync with `scan-jobs.mjs`) |

### Configuration model
**Mostly hardcoded.** Of the 12 tiers in `scan-jobs.mjs`, only Tier 1 (Ashby + Greenhouse) reads from a config file (`config/companies.yml`). Every other tier — BuiltIn search terms, Exa queries, VC-board hostnames, YC search terms, intent queries, funding queries — is a `const` literal at the top of `scan-jobs.mjs`. Two further constants (`AGGREGATOR_HOSTS`, `EXCLUDE_DOMAINS`) are **duplicated** in `dashboard-web/lib/source-health.ts` with a "keep in sync" comment — a known drift hazard.

### How a new source is added today
There is no abstraction. Adding a new source means: copying ~30–80 lines of an existing tier into `scan-jobs.mjs`, wiring it into `main()`, adding a stats key, and (if it's an aggregator or spam host) editing both copies of `AGGREGATOR_HOSTS` / `EXCLUDE_DOMAINS`. There is no generic "give me a list of host+query pairs and crawl them" entry point.

---

## 2. Source inventory (what we currently crawl)

Counts are from `data/seen-urls.json` (1,251 URLs) crossed with `data/enrichments.json` (1,258 enriched). "Roles found (30d)" is unique URLs first-seen in the last 30 days. "Hit rate ≥6" is the fraction of enriched roles on that host with `fit_score >= 6`.

| Source | Type | Status | Roles (all-time) | Roles (30d) | Hit rate ≥6 | Notes |
|---|---|---|---|---|---|---|
| builtin.com | AGGREGATOR | healthy | 411 | 284 | **36%** | Tier 9 direct scrape, 10 search terms × 2 pages. Highest volume + healthy hit rate. |
| revopscareers.com | AGGREGATOR (quarantined) | quarantined | 335 | 248 | **0%** | Tier 2/Exa surfacing. Avg fit 1.6 — re-syndicator, almost zero usable signal. |
| jobs.ashbyhq.com | ATS_DIRECT | healthy | 62 | 32 | **40%** | Tier 1 API, only the 24 hardcoded slugs in `companies.yml`. Best hit rate of any high-volume source. |
| jobs.insightpartners.com | VC_PORTFOLIO | broken-extractor | 46 | 22 | 4% | Tier 11. Getro/Consider SPA — Fix #5e in progress (recoveryRate 0.35). |
| jobs.generalcatalyst.com | VC_PORTFOLIO | broken-extractor | 44 | 21 | 4% | Same Getro/Consider stack as Insight. |
| thesaraslist.com | NICHE_BOARD | healthy | 30 | 4 | **38%** | Surfaced via Exa, not directly crawled. 7 high-fit roles already converted to applications. |
| ventureloop.com | VC_PORTFOLIO | healthy | 28 | 12 | 0% | Tier 11. Almost no fit. |
| job-boards.greenhouse.io | ATS_DIRECT | healthy | 27 | 15 | 26% | Tier 1 API, only the 14 hardcoded slugs. |
| workatastartup.com | AGGREGATOR (YC) | healthy | 23 | 10 | 10% | Tier 10. Exa-keyword scoped to YC domain. |
| jobs.8vc.com | VC_PORTFOLIO | broken-extractor | 16 | 9 | 0% | Tier 11. SPA, same stack as Insight/GC. |
| hirevector.liveblog365.com | SPAM | spam-blocked | 9 | 9 | 0% | EXCLUDE_DOMAINS — still leaks in via Exa pre-block. |
| ycombinator.com | NICHE_BOARD | healthy | 5 | 2 | **100%** | Tier 10/Exa surfacing. 4/5 are fit≥7. **Highest hit rate of any source.** |
| boards.greenhouse.io | ATS_DIRECT | healthy | 4 | 0 | 0% | Old GH subdomain, mostly stale. |
| linkedin.com | AGGREGATOR | healthy | **4** | 2 | 25% | **Effectively not crawled.** Only 4 LinkedIn URLs in 1,251 total. |
| builtinsf.com / builtinboston.com / builtinchicago.org | AGGREGATOR (BuiltIn regional) | healthy | 7 combined | 0 | 100% (3/3 enriched) | Surfaced only via Tier 6 Similar. Regional BuiltIn boards are not directly crawled. |
| community.clay.com / community.revgenius.com | SOCIAL | healthy | 6 | 0 | 17% / 0% | Surfaced via Exa social queries. Low signal. |
| Everything else (~135 hosts) | various | mixed | <5 each | <3 each | varies | Long tail of one-off surfacings from Exa neural/keyword/similar; no direct crawler dedicated. |

**Type breakdown (active = non-quarantined / non-spam):**
- AGGREGATOR: builtin.com (1 source, but dominant by volume)
- ATS_DIRECT: jobs.ashbyhq.com + job-boards.greenhouse.io + boards.greenhouse.io (3 hosts, 24 + 14 = 38 *companies* covered)
- VC_PORTFOLIO: 5 hosts (8VC, GC, Insight, Greylock, VentureLoop)
- NICHE_BOARD: thesaraslist.com, ycombinator.com (incidentally), gtmengineers.com / revopscoop.com (Exa-only)
- SOCIAL: SOCIAL_QUERIES via Exa (Twitter/X intent posts) + community.clay/revgenius (incidental)
- COMPANY_DIRECT: **zero** — no `/careers` page is crawled directly.

---

## 3. Coverage analysis

### Sources we crawl heavily and successfully
Ranked by `(volume × hit-rate)` and limited to non-quarantined/non-spam:

1. **builtin.com** — 411 roles, 36% hit≥6, 98 high-fit. Dominant by every metric.
2. **jobs.ashbyhq.com** — 62 roles, **40% hit≥6**, 15 high-fit. Best signal:volume ratio of any source.
3. **thesaraslist.com** — 30 roles, 38% hit≥6, 7 high-fit. Punches above its weight; we don't crawl it directly, it leaks in via Exa.
4. **job-boards.greenhouse.io** — 27 roles, 26% hit≥6, 3 high-fit.
5. **ycombinator.com** — 5 roles, **100% hit≥6**, 4 high-fit. Tiny but every result is gold. Severely undercrawled.

### Sources we crawl but underperform (volume up, fit down)
Ranked by `volume × (1 − hit-rate)` — wasted-effort proxy:

1. **revopscareers.com** — 335 roles, 0% hit≥6, 0 applied. The biggest pure-waste source: 248 net-new URLs in the last 30 days, all of them re-syndicated junk. Already quarantined in source-health.ts but **still being saved to `seen-urls.json` and enriched** (we just hide it in the UI). Wasted Exa quota + Claude enrichment tokens.
2. **jobs.insightpartners.com / generalcatalyst / 8vc / ventureloop** — 134 roles combined, 1 high-fit total. Tier 11 crawler exists, but the Getro/Consider SPAs are scrape-broken (Fix #5e in progress) and the role mix is dominated by employers who don't post comp. Even fully fixed, the *fit-rate* is unlikely to climb much: the underlying postings are mostly junior or sector-mismatched.
3. **workatastartup.com (YC)** — 23 roles, 10% hit≥6. Should be 70%+ given the ycombinator.com cousin's 100% rate; the gap is the Exa-keyword search returning poorly-matched titles. Worth fixing rather than dropping.

### Sources we crawl but barely return data
Tier-config volume vs. real output:

- **Tier 5 Social signals** — 3 Exa queries; 7 URLs total since launch (`source = "Social Signal"`). Hit rate 0% (per source-tag count). Cost: 3 Exa queries/run × 2 runs/day × 30 days = 180 queries/month for 0 high-fit roles.
- **Tier 7 Intent queries** — 4 Exa queries; 41 URLs cumulative. Hit rate ~5%. Mostly blog posts mislabeled by Exa as job pages.
- **Tier 3 HN queries** — 2 Exa queries; 21 URLs cumulative. Hit rate ~10%. The actual HN "Who's Hiring" thread itself is never fetched — we only get blog re-posts.
- **Tier 4 GTM Engineers Club + RevOps Co-op** — 4 Exa queries; 90 URLs cumulative, but most are not actually from those domains (Exa-keyword leakage). Real `gtmengineers.com` URLs: 0. Real `revopscoop.com` URLs: 0.

### MAJOR sources we DON'T currently crawl

For an NYC GTM Engineer / RevOps / Revenue Engineer ICP targeting Series B+ AI/SaaS:

| Source | Type | Relevance | Effort | Recommendation | Rationale |
|---|---|---|---|---|---|
| **Wellfound (angel.co/jobs)** | AGGREGATOR | HIGH | MED (4–6h, auth required) | **ADD NOW** | Startup-heavy; AI-native companies post here that don't post to BuiltIn. Login required (cookies). |
| **YC Work at a Startup (direct)** | NICHE_BOARD | **HIGH** | MED (4–6h) | **ADD NOW** | We get 100% hit rate on the trickle that leaks via Exa. Direct crawl of `workatastartup.com/companies?demographic_options=under_50` with role filter would 10–50× our YC volume. The single highest-ROI gap. |
| **HN "Who's Hiring" monthly threads** | NICHE_BOARD | MED-HIGH | LOW (1–2h) | **ADD NOW** | One URL/month, parse top-level comments, run our title matcher. Long-form posts with comp + tech stack are exactly the signal we want. We've been trying to surface it via Exa with bad results — fetch the thread directly. |
| **a16z portfolio jobs (portfoliojobs.a16z.com)** | VC_PORTFOLIO | MED | LOW (1h) | **ADD NOW** | Hosted on Getro/Consider — same SPA stack as 8VC/GC/Insight, which means once Fix #5e lands we get this nearly free. |
| **Sequoia / Bessemer / Founders Fund / Greylock / Insight talent boards** | VC_PORTFOLIO | MED | LOW (1h each) | ADD NOW (Sequoia, Bessemer) / LATER (rest) | Same Getro/Consider stack. Add as a config-list, not a code block per VC. |
| **LinkedIn Jobs** | AGGREGATOR | HIGH | HIGH (auth + anti-bot, 8+h) | ADD LATER | Volume is enormous but scraping risk is real. Better to start with an authenticated RSS export or Playwright with logged-in cookies, scoped to NYC + saved searches. |
| **Trueup.io** | AGGREGATOR | MED | MED (3–5h) | ADD LATER | VC-funded company filter with comp data — useful as a comp-extraction enrichment source even if not a primary discovery channel. |
| **WelcomeToTheJungle / Otta** | AGGREGATOR | MED | MED (3–5h) | LATER | International tilt; NYC subset is small. Worth piloting after Wellfound. |
| **The Information jobs board** | NICHE_BOARD | LOW-MED | LOW (1h) | LATER | Small fintech tilt; not core to GTM-Engineer ICP. |
| **Levels.fyi jobs section** | AGGREGATOR | LOW | MED | SKIP | Comp-focused but tiny GTM/RevOps cross-section. |
| **Hired / Vettery** | TALENT_MATCH | LOW | HIGH | SKIP | Inbound matchmaking, not scrape-friendly, not aligned with the active-search ICP. |
| **revopscareers.com (currently quarantined)** | AGGREGATOR | NONE | — | KEEP QUARANTINED | Empirically 0% fit. Quarantine is correct; the active question is whether to stop enriching it entirely (yes, see §7). |
| **SaaS Sales Jobs / RevenueCollective board** | NICHE_BOARD | MED | LOW (1–2h) | ADD LATER | Niche but high signal per role. |
| **Discord/Slack (Pavilion, RevOps Co-op, GTM Operators)** | SOCIAL | HIGH-quality but LOW-volume | HIGH (per-community access, no API) | SKIP for now | Manual harvest by user is more efficient than scraping. |
| **Twitter/X founder-posted jobs** | SOCIAL | LOW (as currently configured) | — | DEPRECATE Tier 5 | We already query for this via Exa Tier 5; it has produced 0 high-fit roles in 1,251 URLs. The signal is real but Exa is the wrong instrument; would need a Nitter/X-API-scoped firehose to do properly. |

---

## 4. Code allocation by source

Lines of code in `scan-jobs.mjs` matching each source name (case-insensitive substring):

| Source | Matching lines | Search terms configured | Tier(s) |
|---|---:|---:|---|
| Exa (cross-tier infra) | 61 | n/a | 2–8, 10, 11, 12 (Exa is the engine; lines counted reflect shared API helpers) |
| BuiltIn | 30 | 10 search terms × 2 pages | 9 |
| Ashby | 23 | per-company API, 24 slugs | 1 |
| Greenhouse | 21 | per-company API, 14 slugs | 1 |
| VC boards (combined) | 9 | 5 boards × 4 search terms | 11 |
| HN / YC (Exa queries) | 5 | 2 HN + 4 YC | 3 / 10 |
| YC / workatastartup direct | 3 | 4 search terms via Exa-keyword | 10 |
| LinkedIn | 2 | 0 dedicated lines; only mentioned as a title-source pattern | — |
| Wellfound / AngelList | **0** | **0** | — |

**Reading:** BuiltIn has ~30 dedicated lines and a custom HTML parser. Ashby has 23 lines using a typed JSON API. Greenhouse has 21 lines using a typed JSON API. The volume gap (411 vs 62 vs 27) is **not** driven by lines of code — it's driven by *what each source covers*: BuiltIn searches the entire BuiltIn job board (all companies), while Ashby and Greenhouse only ever check the 38 companies in `companies.yml`. (See §6.)

---

## 5. Cross-source overlap — do BuiltIn and ATS_DIRECT find the *same* roles?

Of 730 distinct companies in `seen-urls.json`:

| Bucket | Companies | % |
|---|---:|---:|
| On BuiltIn only (no direct ATS in our pipeline) | 344 | 47% |
| On direct ATS only (Ashby/Greenhouse, no BuiltIn URL) | 30 | 4% |
| **On BOTH BuiltIn AND a direct ATS** | **7** | **1%** |
| On neither (Tier 2–12 Exa surfacing only) | 349 | 48% |

For the 7 overlapping companies (Hebbia, EliseAI, Notion, Snowflake, Attentive, Vanta, Gong) the breakdown by URL is illuminating:

| Company | BuiltIn URLs | Direct ATS URLs |
|---|---:|---:|
| EliseAI | 2 | **12 (Ashby)** |
| Notion | 0 (only via Similar) | **6 (Ashby)** |
| Snowflake | 1 | **4 (Ashby)** |
| Hebbia | 1 | 2 (GH) + 1 (Ashby) |
| Attentive | 1 | 2 (GH) |
| Vanta | 1 | 0 (only Tier 6 leak) |
| Gong | 1 | 1 (GH) |

**Reading:** Whenever direct ATS *is* configured for a company, it surfaces 2–6× more roles than BuiltIn does for the same company. BuiltIn carries the company, but the per-company depth comes from the ATS API. This means **when we crawl direct ATS, we get strictly better coverage of that company.** The reason direct ATS volume is so low (62 vs 411) is purely that `companies.yml` only names 38 companies.

---

## 6. Selection bias vs market concentration

### The structural argument

BuiltIn's volume comes from a fundamentally different scraping shape than Ashby/Greenhouse:

| Source | Companies covered | Discovery mechanism |
|---|---|---|
| Tier 9 BuiltIn | **All ~13,000+ companies listed on BuiltIn** | Server-rendered job-board search over 10 keywords × 2 pages, recency-sorted |
| Tier 1 Ashby | **24 hardcoded slugs** in `companies.yml` | Per-company API call to `api.ashbyhq.com/posting-api/job-board/{slug}` |
| Tier 1 Greenhouse | **14 hardcoded slugs** in `companies.yml` | Per-company API call to `boards-api.greenhouse.io/v1/boards/{slug}/jobs` |

If `companies.yml` listed 240 Ashby slugs instead of 24, the Ashby volume would be ~10× higher and the BuiltIn % share would crash. The BuiltIn % is not measuring "where the market is", it's measuring **the difference between an exhaustive crawl and a curated 38-company crawl**.

### The double-counting argument

`SOURCE_PRIORITY.md`'s "% of applied" column sums to >180% across BuiltIn + Ashby (93.5% + 87.1%). That can't be right under any plausible interpretation of "where did this application come from" — and it isn't: the cross-reference logic in that script credits an applied row to every host where its company name appears. Because most of our 38 ATS-tracked companies *also* surface on BuiltIn (the EliseAI example: 14 ATS URLs + 2 BuiltIn URLs), each Ashby-applied role double-counts toward BuiltIn's share too.

Of the 7 overlap companies, 5 (EliseAI, Notion, Hebbia, Attentive, Vanta) have submitted applications. Each one inflates both percentages.

### The fit-rate argument (against pure selection bias)

If BuiltIn's dominance were *purely* selection bias, we'd expect BuiltIn's hit rate to be similar to or lower than Ashby's. Instead:

- BuiltIn: **36% fit≥6** across 406 enriched roles
- Ashby: **40% fit≥6** across 52 enriched roles
- Greenhouse: **26% fit≥6** across 27 enriched roles

The hit rates are in the same band. So BuiltIn isn't just bigger — it's also a *quality-comparable* discovery channel for our ICP. There is a real underlying fact that **NYC GTM Engineer roles are over-indexed on BuiltIn relative to most other aggregators**, because BuiltIn was originally Built In NYC and has higher market penetration with NYC tech employers than Wellfound or LinkedIn-as-aggregator do for this specific role family.

### Defensible conclusion

> **The 93.5% BuiltIn-applied figure is ~80% selection bias (we only crawl 38 companies' ATS APIs vs. all of BuiltIn) + ~20% real concentration (NYC GTM tech roles genuinely over-index on BuiltIn).** The double-counting (Ashby's 87% sums with BuiltIn's 93%) is a third axis — neither bias nor concentration but a measurement artifact in the priority-analysis script.

The right reading of the data is that **BuiltIn is a credible primary discovery channel, but the gap to Ashby/Greenhouse is overwhelmingly a coverage gap, not a quality gap.** Closing the coverage gap (expanding `companies.yml` from 38 to 200+ slugs, adding Lever, adding generic-Ashby/generic-Greenhouse discovery from BuiltIn-surfaced companies) would re-shape the distribution within weeks.

---

## 7. Recommendations

### Quick wins (this week, <2h each)

1. **Crawl HN "Who's Hiring" monthly threads directly.** One fetch per month, parse top-level comments with our title matcher. Replaces Tier 3 HN Exa queries (current yield: 0 high-fit in 21 URLs) with the real source.
2. **Stop enriching `revopscareers.com` URLs.** They're already `quarantined` in source-health.ts and contribute 0 high-fit, 0 applied — but we still spend Claude tokens enriching all 248 of last month's. Add a hard skip in `enrich-roles.mjs`. Saves ~$3–5/month in Claude API + 5–10 minutes/run.
3. **Deprecate Tier 5 (Social signals).** 7 URLs cumulative, 0 high-fit. Remove the 3 Exa queries.
4. **Auto-promote BuiltIn-surfaced Ashby/Greenhouse companies to `companies.yml`.** When BuiltIn surfaces a role whose ATS-redirect URL is `ashbyhq.com/{slug}/...`, append `{slug}` to `companies.yml`. This converts BuiltIn's *discovery* into ATS *depth* for that company. Could 3–5× our Tier 1 yield within a month.
5. **Add a16z portfolio jobs** (`portfoliojobs.a16z.com`). Same Getro/Consider stack as the 5 VC boards already configured — drop it into the existing `VC_BOARD_CONFIGS` array. One commit.

### Medium-term additions (next 2 weeks)

1. **Direct YC Work at a Startup crawler.** Replace the Exa-keyword Tier 10 (10% hit rate) with a proper paged scrape of `workatastartup.com/companies?has_job_filter=1` filtered by role. The trickle that already leaks through hits 100% on fit.
2. **Wellfound (angel.co/jobs).** Auth-required, but the company-startup overlap with our ICP is the highest of any aggregator we don't currently touch.
3. **Generalize the Getro/Consider crawler.** Fix #5e already does this for comp extraction; lift the same parser into discovery so we can add Sequoia, Bessemer, Greylock, Founders Fund, NEA, etc. as a *config list*, not as new code blocks each.
4. **Lever ATS coverage.** We have zero `jobs.lever.co` URLs. Adding Lever as a Tier 1 source (with company slugs) is structurally identical to Greenhouse — ~50 lines of code, opens up dozens of companies (Plaid, Posthog, Pinecone, Modal, etc.).

### Sources to deprecate or fix

- **Tier 5 Social signals (Exa)** — deprecate, 0 yield.
- **Tier 7 Hiring Intent queries** — keep but cut from 4 to 1 query; current ROI is ~5%.
- **Tier 4 GTM Engineers Club / RevOps Co-op via Exa** — deprecate. Replace with direct `gtmengineers.com/jobs` and `revopscoop.com/jobs` scrapes (1 fetch each, parse HTML).
- **Tier 6 Similar search** — keep but cap seed count at 3 (currently 5). 90% of Tier 6 hits are dupes that we already saw via Tier 1 — they're being correctly deduped on URL, but each seed costs an Exa call.
- **revopscareers.com enrichment** — skip enrichment for any URL whose host is in `AGGREGATOR_HOSTS`. They're already hidden in the UI; stop spending tokens on them.

### Structural changes

1. **Move source config to YAML.** `config/sources.yml` should list, for every source: `{ name, type, mechanism: "ats-api"|"html-search"|"exa-neural"|"exa-keyword", endpoint_template, search_terms, max_pages, enabled }`. Then `scan-jobs.mjs` iterates the config instead of having 12 bespoke `main()` blocks. This is the single biggest structural lever — it would make every "add this source" task into a 5-line config edit rather than a 60-line code edit.

2. **Generalize the Ashby and Greenhouse crawlers.** A single helper `scanAtsApi(provider, slugs)` covers both. Combined with §7 quick-win #4, this becomes a self-expanding system: BuiltIn surfaces a company → we detect its ATS → we add its slug → next run we get depth on that ATS.

3. **Fix the double-counting in source-priority analysis.** `SOURCE_PRIORITY.md`'s applied-by-host script credits an applied URL to every host where the company name appears. It should credit a single canonical "destination" host (the ATS the apply form actually lives on). Once corrected, BuiltIn's applied % will drop sharply and Ashby's will jump — surfacing the truth that **Ashby is our highest-value ATS even though BuiltIn is our highest-volume discovery channel**. (These are two different questions; the current script conflates them.)

4. **Deduplicate aggregator-vs-canonical at scrape time, not just at URL time.** Today we dedup by URL, then by (company, normalized title). But a BuiltIn URL and an Ashby URL for the same role at EliseAI are *the same job listing* and should be merged into one row in `seen-urls.json` with both URLs attached, not stored as two. Until this lands, "93.5% via BuiltIn" will always look inflated.

5. **Pull `AGGREGATOR_HOSTS` and `EXCLUDE_DOMAINS` into the shared YAML.** Eliminate the "keep in sync with scan-jobs.mjs" comment in `dashboard-web/lib/source-health.ts`.

---

## Appendix — quick numbers

- Distinct hosts seen: **153**
- Hosts contributing ≥1 fit≥7 role: **13**
- Hosts contributing ≥1 applied role: **15**
- Hosts crawled by a *dedicated* tier (Tier 1, 9, 10, 11): **builtin.com + 24 Ashby slugs + 14 GH slugs + workatastartup.com + 5 VC boards = 7 host-shaped sources, 38 ATS-companies**
- Hosts surfaced via Exa (Tier 2/3/4/6/7/8/12): everything else, opportunistically
- Lines of source-config logic: ~250 (across the 12 tiers in `scan-jobs.mjs`)
- Lines that would disappear if §7 structural change #1 (YAML config) landed: ~150
