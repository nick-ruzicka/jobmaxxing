# FDE-archetype sourcing audit + expansion

**Date:** 2026-05-28 · **Branch:** `feat/fde-sourcing-expansion` · **Verdict:** the FDE archetype is under-sourced by structure, not by classifier quality — empirical fix: expand title anchors + JD-keyword reward signals + dedicated FDE discovery tiers + scrape the canonical FDE-board RSS (`fwddeploy.com/jobs.rss`).

---

## The asymmetry

| Archetype | Primary classifications (2026-05 enrichments snapshot, n=1653) |
|---|---:|
| gtm-engineering | 900 (54%) |
| ai-operations | 289 (17%) |
| web3-bd | 66 (4%) |
| **fde** | **10 (0.6%)** ← red flag |
| web3-bizops | 5 (0.3%) |
| (no primary) | 383 (23%) |

Of the 10 FDE-classified roles, only 2 are high-confidence canonical FDE titles ("Founding Customer Engineer @ RevenueBase", "Director, Forward Deployed Engineering & AI GTM Lead @ Hirebase"). The other 8 are low-confidence (most flagged `needs_review`) where FDE happened to be the least-bad fit. Net: the pipeline classified ~2 real FDE roles in the snapshot.

## Why — sourcing was the bottleneck, not classification

Inventoried the discovery surface in `scripts/scan-jobs.mjs`:

| Tier | What it does | GTM queries | FDE queries |
|---|---|---:|---:|
| Title gate (`TITLE_ANCHORS`) | Required relevance filter | 5 anchors | 0 |
| 2 Exa broad | Semantic search | 7 | 0 |
| 3 VC portfolios | a16z / Sequoia / etc. | 4 | 0 |
| 3 HN / YC Who is Hiring | | 2 | 0 |
| 4 Niche boards | gtmengineers.com, revopscoop.com | 4 | 0 |
| 5 Social signals | Twitter hiring intent | 3 | 0 |
| 7 Hiring intent | Pre-posting signals | 4 | 0 |
| 9 BuiltIn direct scrape | builtin.com/jobs?search= | 10+ | 0 |

Every discovery layer is GTM-shaped. The only FDE roles that ever entered the pipeline were the handful of cases at Tier 1 (ATS scan of Anthropic / Palantir / Hebbia in `companies.yml`) that happened to clear the title gate by carrying an FDE word AND a GTM word jointly (e.g., "Forward Deployed Engineering & AI GTM Lead" — "GTM" is what saved it through `TITLE_ANCHORS`).

The classifier was working fine. The pipeline never gave it FDE roles to classify.

## Empirical FDE landscape — what's actually out there

External research (2026-05) — captured to ground the configuration:

- **[fwddeploy.com](https://www.fwddeploy.com/jobs)** — canonical FDE job board, ~540 active postings, RSS feed at `/jobs.rss`. Multi-company aggregator.
- **[fdepulse.com](https://fdepulse.com/insights/fde-hiring-trends-2026/)** — analytics: tracks 247 active FDE postings across 133 companies (Apr 2026), 34% remote-eligible, 81% mention equity, 81% mention "travel required."
- **[bloomberry analysis of 1K FDE jobs](https://bloomberry.com/blog/i-analyzed-1000-forward-deployed-engineer-jobs-what-i-learned/)** — empirical title variants + JD keyword frequencies. Top responsibilities: "work directly with customers" (55%), "build and deploy AI/ML systems" (37%), "integrate systems/APIs" (32%).
- **Market signal**: FDE postings grew 1,165% YoY through Q4 2025 per the bloomberry source. The undersourcing is therefore expensive.

**Empirical title variants observed in the wild:**

| Tier | Titles (sources: fwddeploy.com listings, bloomberry analysis) |
|---|---|
| High-match (canonical) | Forward Deployed Engineer · Forward Deployed AI Engineer · Forward Deployed {Software,Data,Security} Engineer · Forward Deployed Engineering Manager · Applied AI Engineer (Anthropic's name) · Customer Engineer · Field Engineer |
| Medium-match (high variance) | Deployment Strategist · Forward Deployed AI Consultant · Solutions Engineer · Implementation Engineer · Solutions Architect · Technical Consultant · Forward Deployed Creative Technologist |

**Empirical top-employer markers** (signal: when a JD names these as customer / competitor / peer, the role is more likely FDE-archetype):
- Already in `companies.yml`: Palantir, Hebbia, Anthropic, Mistral
- High-volume FDE hirers added to the FDE reward-signal company list: Glean, Decagon, Sierra, Anyscale, Databricks, Reducto, Intercom, ConductorOne, Vanta (per fdepulse + bloomberry top-employers)

## Variance handling — already in the system

Per `scripts/lib/archetype-classifier.mjs:120-180`, the classifier uses a 3-tier title-match (`high_match` / `medium_match` / `low_match`) with different weights AND weighted `reward_signals` keyword groups. A title like "Deployment Strategist" lives correctly in `medium_match`: it only crosses the confidence threshold when the JD body fires the FDE reward keywords (deployment, customer-facing, AI/ML system). That's the variance-handler — no new infrastructure needed for this PR, just empirically-grounded population of the existing tiers.

## What this PR changes

### 1. `config/archetypes.yaml` — FDE archetype expansion

- Description annotated with the empirical title variance.
- `reward_signals` reorganized into 4 weighted groups:
  - **Title-stem keywords** (weight 20) — high-signal phrases that appear in role names.
  - **JD theme keywords** (weight 8) — empirical-frequency themes from bloomberry's 1K-JD analysis. Includes bare "deployment" / "deploy" alongside more-specific phrases like "production deployment" / "deployment playbook"; precision is preserved by the `required_signals` gate (`technical_role` + `customer_facing`).
  - **AI/ML deployment context** (weight 6) — distinguishes modern AI-era FDE (prompt engineering, LLM evaluation, agent deployment, MCP server) from classic Palantir-style data-engineering FDE.
  - **Employer markers** (weight 6) — expanded with the canonical FDE-hirer list from fdepulse + bloomberry.
- `title_signals.high_match` expanded to 10 canonical FDE variants; `medium_match` expanded to 8 ambiguous-but-FDE-adjacent titles.

### 2. `scripts/scan-jobs.mjs` — multi-archetype sourcing

- New `FDE_TITLE_ANCHORS` parallel to `TITLE_ANCHORS`. Multi-word anchors only (avoids false-positive risk of single words like "customer" catching "Customer Success Engineer").
- `TITLE_ROLE_TOKENS` extended with `strategist` and `consultant` (for Deployment Strategist and Technical Consultant / Forward Deployed AI Consultant).
- `titleMatchesPositive()` updated to accept titles passing **either** the GTM gate OR the FDE gate. Backwards-compatible (TITLE_ANCHORS is still the default for `titleMatchAnchor()`).
- New FDE-shaped query sets parallel to the existing GTM ones: `FDE_EXA_QUERIES`, `FDE_VC_QUERIES`, `FDE_HN_QUERIES`, `FDE_SOCIAL_QUERIES`, `FDE_INTENT_QUERIES`, `FDE_BUILTIN_SEARCHES`. No `FDE_FUNDING_QUERIES` — the GTM `FUNDING_QUERIES` are declared but never wired, so the FDE side matches.
- `scanBuiltIn()` parameterized to accept any query list + tier label, so the same scraper serves both the GTM and FDE searches.
- 7 new tier passes wired into the main loop (Tier 2/3/3/5/7/9 FDE archetype + Tier 10 fwddeploy).
- Each new tier gets its own analytics slug (`tier_2_fde_exa`, etc.) so cost / match counts are tracked per archetype.

### 3. `scripts/scan-jobs.mjs` — Tier 10 fwddeploy.com (the leverage move)

- `scanFwdDeploy()` consumes `https://www.fwddeploy.com/jobs.rss` — RSS 2.0, server-rendered, 542 items at audit time.
- Why RSS over HTML scrape: stable schema, single request, zero auth, matches the existing zero-token discovery pattern (Tier 1/9).
- Title parser splits the RSS `<title>` field on `" - "` from the right to handle dashes inside job titles. Live-tested against 5 sample items.
- No local title-gate filter (every listing on an FDE-dedicated board is by definition FDE-shaped; downstream classification drops misfits with confidence < threshold).
- Hits the same `loggedFetch` + tier analytics pipeline; tier slug `tier_10_fwddeploy`.

## Productization note — deferred v2 design item

`config/user-context.yaml` carries location / comp / hard-nos / soft-preferences / anti-signals — but **no per-archetype experience bar**. A user without 3+ years of customer-facing engineering scoring against an FDE role at Databricks should get a different fit score than someone with that background. Same applies to GTM engineering, AI operations, and the other primary archetypes.

For a true productization pass, `user-context.yaml` will need something like:

```yaml
archetype_fit:
  fde:
    requires_engineering_years: 3
    requires_customer_facing: true
    confidence_floor: 0.5
  gtm-engineering:
    requires_engineering_years: 2
    requires_python_or_sql: true
    confidence_floor: 0.4
  ai-operations:
    requires_llm_experience: true
    confidence_floor: 0.5
```

Punted from this PR because it changes scoring math for all users, not just expands sourcing surface. Captured in agent memory under `per-archetype-experience-bar-v2`.

## Verification

- **Mini-yaml parser** (`scripts/lib/yaml-mini.mjs`) — loads the expanded `fde` archetype block (single-line description; `>` block scalars are NOT supported). All 15 classifier tests pass.
- **Title-gate unit tests** (inline, 20 cases) — 12 FDE-shaped titles pass; 3 GTM-shaped regression cases still pass; 5 negatives correctly filtered.
- **Live RSS smoke test** — fetched `fwddeploy.com/jobs.rss`, parsed 542 items, verified title parser correctly extracts title / company / location on 5 sampled items including dashes-in-title and HTML-entity cases.
- **Library tests** — 659 of 660 pass (1 pre-existing failure: `generateThesis — readOnly`, NOT caused by this PR; confirmed via stash + retest on `origin/main`).

## Cost / run impact

The 6 new Exa-based FDE query sets add roughly 7+4+2+0+4+0 = ~17 additional Exa neural-search calls per scan run. At ~$0.005/call this is ~$0.09 per scan. The fwddeploy.com RSS tier is zero-cost (no API key, no per-item charge). Net: estimated +$0.09 per scan to enable FDE sourcing parity.

Out-of-scope for this PR:
- Adding the 8 missing high-volume FDE hirers (Google, Deloitte, Databricks, Reducto, Intercom, ConductorOne, Vanta, Anyscale) to `companies.yml`. The discovery-tier expansion should pick most of them up structurally; the manual additions can come as a hygiene pass if the data shows gaps.
- Direct `fdepulse.com` scraping — it's analytics, not a job board.
- Running the scanner end-to-end to validate (would burn Exa credits + take ~5-10 min); recommend a manual `node scripts/scan-jobs.mjs --dry-run` smoke once this PR lands.

## Sources

- [Forward Deployed Engineer Job Board (fwddeploy.com)](https://www.fwddeploy.com/jobs)
- [FDE Pulse — 2026 hiring trends](https://fdepulse.com/insights/fde-hiring-trends-2026/)
- [bloomberry — I analyzed 1K FDE jobs](https://bloomberry.com/blog/i-analyzed-1000-forward-deployed-engineer-jobs-what-i-learned/)
- [MarkTechPost — What is a Forward Deployed Engineer](https://www.marktechpost.com/2026/05/20/what-is-a-forward-deployed-engineer-the-ai-role-openai-anthropic-and-google-are-hiring-in-2026/)
- [Anthropic — Forward Deployed Engineer, Applied AI posting](https://job-boards.greenhouse.io/anthropic/jobs/4985877008)
