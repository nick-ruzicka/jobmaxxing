# Comp Extraction Audit — 2026-05-13

**Question:** is `comp_range: "Not listed"` a true negative (no comp on the page) or a false negative
(comp is there, we didn't extract it)? **Answer: overwhelmingly false negative.** This is the
diagnosis behind Fix #5 (comp extraction *rebuild*, not improvement) and behind the `/sources`
Source Health page.

> Data is read from `data/enrichments.json` (symlink → `nick-career-ops/data/enrichments.json`)
> and `data/seen-urls.json`. Counts below are a snapshot from 2026-05-12/13 — the files are
> appended to live by the scan/enrich pipeline, so absolute numbers drift; the *rates and
> patterns* are what matter.

## 1. The universe

| Bucket | ~Count | ~% |
|---|---:|---:|
| Has a real `comp_range` | ~72 | ~6.6% |
| `comp_range` = `"Not listed"` / `"None"` (enriched OK, no comp captured) | ~825 | ~75% |
| Enrichment **error** (no fields at all — total scrape failure) | ~197 | ~18% |

The comp false-negative universe is the **"Not listed"** rows. The error rows are a separate
problem (SPA-scrape failures — Fix #6 territory) though many sit on the same JSON-LD-bearing hosts.

What works today (extraction is *flaky*, not off): ~28 BuiltIn (~11% of BuiltIn), ~18 Ashby (~30%),
~7 thesaraslist, ~6 revopscareers — and **0% on Greenhouse, Insight Partners, General Catalyst, 8VC.**

## 2. Method

Stratified sample of 30 "Not listed" roles — 10 BuiltIn, 5 Ashby, 5 Greenhouse, 5 Exa-discovered
varied hosts, 5 VC-portfolio boards — drawn deterministically, then each live page fetched and
checked for comp in four locations: (A) JSON-LD `<script type="application/ld+json">` JobPosting
`baseSalary`; (B) page-level structured strip; (C) JD-body prose; (D) genuinely absent. 5 of the
30 original URLs were dead/expired (≈17% — postings churn fast) and were replaced from the same
bucket.

## 3. Result

**22 of 30 are false negatives → ~73% false-negative rate** (24/30 = 80% counting 2 Built In
algorithmic-estimate cases as partial recoveries). **Zero true negatives in BuiltIn (8/10 FN) or
Ashby (5/5 FN)** — the two highest-volume structured sources.

| Source bucket | False Neg | True Neg | Ambiguous | FN rate |
|---|---:|---:|---:|---:|
| BuiltIn | 8 | 0 | 2 | 80% |
| Ashby | 5 | 0 | 0 | 100% |
| Greenhouse | 4 | 1 | 0 | 80% |
| Exa-discovered (varied) | 3 | 2 | 0 | 60% |
| VC-portfolio boards | 2 | 3 | 0 | 40% |
| **Total** | **22** | **6** | **2** | **~73%** |

### By extraction layer (the fix surface)

- **Layer A — JSON-LD JobPosting → `baseSalary`** — ~9 sampled roles fully recoverable this way
  (6 BuiltIn with populated baseSalary, Mural/revopscareers, Camunda + Shelf / Insight Partners).
  - ⚠️ **BuiltIn encodes the script type as `type="application/ld&#x2B;json"`** (the `+` is
    HTML-entity-escaped) and nests JobPosting in an `@graph` array — a naive `type="application/ld+json"`
    match misses every BuiltIn page. This single quirk is why ~89% of BuiltIn reads "Not listed".
  - ⚠️ Handle the single-value form too: `baseSalary.value` can be a scalar `QuantitativeValue`
    (`value` + `unitText`), not just `minValue`/`maxValue` (Mural: $93,730/yr).
- **Layer B — page-level structured strip** (BuiltIn `fa-sack-dollar` span "XXK-YYK Annually") —
  on ~8/10 BuiltIn pages; equals Layer A for those with employer comp; is an *algorithmic estimate*
  when `baseSalary` is null (JobNimbus "36K-180K", Linkup "120K-200K"); and was *wrong* for SentiLink
  ("76K-126K" vs the JD's true "$130K-160K"). ⇒ fallback only; label `(est.)` when baseSalary is null.
- **Layer C — JD-body prose comp** (regex over the JD text *and* the JSON-LD `description` HTML) —
  ~13 sampled roles recoverable only this way: SentiLink, Vibe (BuiltIn prose-only); all 5 Ashby
  (range always in the `description` prose, never in the structured `baseSalary`); all the Greenhouse
  roles (Greenhouse emits **no JSON-LD** — the pay range is a plain server-rendered `<div>`:
  "Pay Transparency Range", "Tier N Pay Range", "base salary range"); the liveblog365 aggregators.
- **Genuinely absent / qualitative-only — no fix** — ~6 sampled (Braze "competitive compensation",
  Ethos, Saronic "competitive salary", Prepared "competitive salary", Talos, Serotonin). Tag as
  `qualitative_only` so they aren't re-fetched.

### Five most impactful false negatives (sample evidence)

| Role / URL | We said | On the page | Fix |
|---|---|---|---|
| Camunda — Director, RevOps `jobs.insightpartners.com/companies/camunda/jobs/47555852-…` | "Not listed" (verdict: "completely broken — just HTML code, JS snippets, tracking pixels") | JSON-LD JobPosting `baseSalary {minValue 209100, maxValue 313600, unitText YEAR}` — in the *raw* HTML | Fix 5e — parse JSON-LD from raw HTML for Getro/Consider VC boards (also recovers the JD) |
| Vultr — Revenue Operations Manager `builtin.com/job/revenue-operations-manager/3596033` | "Not listed" | JSON-LD `baseSalary $85K–130K` + strip "85K-130K Annually" + JD prose "Compensation $85,000 - $130,000" — triple-redundant | Fix 5a — BuiltIn JSON-LD parser (decode `&#x2B;`, walk `@graph`, read `baseSalary`) |
| EliseAI — GTM Engineer `jobs.ashbyhq.com/eliseai/7a74322c-…` | "Not listed" | JSON-LD `description` contains "The salary range for this role is $100,000–$200,000" | Fix 5c — run comp regex over the JSON-LD `description` field |
| Apollo.io — GTM Engineer II, Mid-Market `job-boards.greenhouse.io/apolloio/jobs/5918855004` | "Not listed" (but the JD text *was* captured) | server-rendered `<div>`: "Tier 1 Pay Range (SF, NYC, Seattle) $150,000 - $175,000 USD" | Fix 5d — deterministic regex post-pass over the captured JD |
| Mural — RevOps Business Partner `revopscareers.com/job/mural-revenue-operations-business-partner-united-states` | "Not listed" | JSON-LD `baseSalary {value: 93730.0, unitText: YEAR}` | Fix 5b — revopscareers JSON-LD parser (single-value scalar form) |

## 4. Projected impact

Applying the per-source false-negative rates from the sample to the "Not listed" rows (plus the
chunk of scrape-error rows on JSON-LD-bearing hosts): **"Has Comp" coverage goes from ~6.6% today
to ~45–55% (~500–600 roles)**. Biggest single lever: the BuiltIn JSON-LD parser (~185–230 roles
from a ~10-line change). Then revopscareers (~130), then Ashby + Greenhouse + the JSON-LD-bearing
VC boards (~85 combined).

## 5. Verdict

**Fix #5 is "rebuild a broken thing," not "improve a working thing."** ~73% false-negative rate;
zero true negatives in the two highest-volume structured sources; 0% extraction on Greenhouse and
every VC board despite the comp being plainly in the HTML. The ~6.6% that's populated is mostly
Claude incidentally copying a pay line out of a JD — there is no reliable extraction path today.

## Per-host recovery rates (drives `dashboard-web/lib/source-health.ts` `AUDIT_FINDINGS`)

Sample-derived (n=30). Confidence: medium-high for top-volume hosts (BuiltIn, Ashby, Greenhouse);
lower for tail hosts. Update this table and `AUDIT_FINDINGS` together when re-auditing.

| host (or parent domain) | recoveryRate | fixId | diagnosis |
|---|---:|---|---|
| `builtin.com` | 0.80 | 5a | JSON-LD JobPosting present but `type="application/ld&#x2B;json"` (entity-encoded `+`), nested in `@graph` — naive parsers miss it; ~11% extracted today. |
| `jobs.ashbyhq.com` | 0.85 | 5c | Structured `baseSalary` always null; pay range lives in the JSON-LD `description` prose ("The salary range for this role is $X–$Y"); ~30% extracted. |
| `job-boards.greenhouse.io` | 0.75 | 5d | No JSON-LD at all; pay range is a plain server-rendered `<div>` ("Pay Transparency Range", "Tier N Pay Range", "base salary range"); 0% extracted. |
| `boards.greenhouse.io` | 0.75 | 5d | Same as `job-boards.greenhouse.io`. |
| `revopscareers.com` | 0.45 | 5b | Aggregator (quarantined). Emits JSON-LD JobPosting with `baseSalary`, often single-value scalar form ($93,730/yr); many entries are thin re-scrapes with no baseSalary; 2% extracted. |
| `jobs.insightpartners.com` | 0.35 | 5e | Getro/Consider SPA — JSON-LD JobPosting (incl. `baseSalary` when the ATS has it) is in the *raw* HTML; pipeline scrapes the SPA shell ("completely broken HTML" verdicts); 0% extracted, ~44% scrape errors. |
| `jobs.generalcatalyst.com` | 0.30 | 5e | Same Getro pattern; `baseSalary` is employer-dependent. |
| `jobs.8vc.com` | 0.30 | 5e | Same Getro pattern. |
| `liveblog365.com` | 0.40 | — | Spam-blocked (EXCLUDE_DOMAINS). Pages do carry JSON-LD JobPosting with comp in the `description` ("base compensation band $X–$Y", "Pay: $X–$Y/month"), but JD quality is poor — not worth recovering unless unquarantined. |
| `thesaraslist.com` | 0.20 | — | SPA; job-specific pages expire fast (high dead-link rate); ~33% comp already extracted. |
| `anywhereremotejobs.com` / `kickstartremote.com` / `totalh.net` / `wuaze.com` / `page.gd` / `saashero.net` | 0.10 | — | Content-farm / suspended hosts — no reliable JD content. |
