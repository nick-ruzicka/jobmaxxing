# Source Priority Analysis (empirical, generated 2026-05-14)

Generated from `data/seen-urls.json` (1251 URLs), `data/enrichments.json` (1258 enriched), and `data/applications.md` (31 applied rows).

**Working definitions**
- *applied* = status ∈ {Applied, Interview, Offer, Rejected} in applications.md (Skipped/Evaluated excluded — they're decisions to not pursue).
- *high-fit* = `fit_score >= 7` in enrichments.json (score scale 1–9 in this dataset).
- Application↔URL match is by company-name normalization (lowercase, strip parenthetical, 6-char prefix match) — imperfect but covers most cases.

## Top 20 sources by role count

| #  | host                       | roles | %     | ATS                    | sample companies                                                                            |
|----|----------------------------|-------|-------|------------------------|---------------------------------------------------------------------------------------------|
| 1  | builtin.com                | 411   | 32.9% | BuiltIn (aggregator)   | Hebbia, Notion, Toast                                                                       |
| 2  | revopscareers.com          | 335   | 26.8% | RevOpsCareers (custom) | Scale Ai Inc, Pliant, Jiko                                                                  |
| 3  | jobs.ashbyhq.com           | 62    | 5.0%  | Ashby                  | Rillet, Hebbia, EliseAI                                                                     |
| 4  | jobs.insightpartners.com   | 46    | 3.7%  | custom (company board) | Technical GTM Engineer, Safetyculture 2 D0ff86a5 3d05 4aa1 A51f A3a13f7b2cf7, Papaya Global |
| 5  | jobs.generalcatalyst.com   | 44    | 3.5%  | custom (company board) | Aven, Render, Pylon 2 Cde7f5c8 0baf 406d A336 9c6077914985                                  |
| 6  | thesaraslist.com           | 30    | 2.4%  | custom/unknown         | Zip, Rillet, Scribe                                                                         |
| 7  | ventureloop.com            | 28    | 2.2%  | custom/unknown         | MinIO, Arcoro, ShipBob                                                                      |
| 8  | job-boards.greenhouse.io   | 27    | 2.2%  | Greenhouse             | Hebbia, Attentive, Intercom                                                                 |
| 9  | workatastartup.com         | 23    | 1.8%  | custom/unknown         | Relace, Weave, Glimpse                                                                      |
| 10 | jobs.8vc.com               | 16    | 1.3%  | custom (company board) | Vercel, Prepared, Rocketlane                                                                |
| 11 | hirevector.liveblog365.com | 9     | 0.7%  | custom/unknown         | Hirevector, US | Remote | Hirevector, SaaS (100% Remote outside of Canada) | Hirevector     |
| 12 | remotica.totalh.net        | 8     | 0.6%  | custom/unknown         | Remote, Remotica, LinkedIn Outreach Automation Specialist — Lead Gen | Remotica             |
| 13 | jobflarely.liveblog365.com | 8     | 0.6%  | custom/unknown         | Jobflarely, US | Remote | Jobflarely, Remote at Urrly                                       |
| 14 | fullcast.com               | 7     | 0.6%  | custom/unknown         | Fullcast                                                                                    |
| 15 | hubspot.com                | 5     | 0.4%  | custom/unknown         | HubSpot, Hubspotjobs                                                                        |
| 16 | ycombinator.com            | 5     | 0.4%  | YC Work at a Startup   | Arcline | Y Combinator, Klarity | Y Combinator, PointOne | Y Combinator                     |
| 17 | boards.greenhouse.io       | 4     | 0.3%  | Greenhouse             | Braze                                                                                       |
| 18 | revpath.dealhub.io         | 4     | 0.3%  | custom/unknown         | RevPath, EliseAI                                                                            |
| 19 | jaabz.com                  | 4     | 0.3%  | custom/unknown         | United State, Xentral ERP Software - Greater Kempten Area | Visa Sponsorship Jobs           |
| 20 | saashero.net               | 4     | 0.3%  | custom/unknown         | SaaS Hero                                                                                   |

## Top sources by APPLIED roles

Cross-referenced applications.md against seen-urls.json by normalized company name. **31** applications total.

| #  | host                      | applied roles matched | % of applied | ATS                    |
|----|---------------------------|-----------------------|--------------|------------------------|
| 1  | builtin.com               | 29                    | 93.5%        | BuiltIn (aggregator)   |
| 2  | jobs.ashbyhq.com          | 27                    | 87.1%        | Ashby                  |
| 3  | thesaraslist.com          | 7                     | 22.6%        | custom/unknown         |
| 4  | job-boards.greenhouse.io  | 4                     | 12.9%        | Greenhouse             |
| 5  | jobright.ai               | 3                     | 9.7%         | custom/unknown         |
| 6  | proptechtalent.org        | 2                     | 6.5%         | custom/unknown         |
| 7  | builtinboston.com         | 1                     | 3.2%         | custom/unknown         |
| 8  | builtinchicago.org        | 1                     | 3.2%         | custom/unknown         |
| 9  | jobs.sapphireventures.com | 1                     | 3.2%         | custom (company board) |
| 10 | revpath.dealhub.io        | 1                     | 3.2%         | custom/unknown         |
| 11 | spainjobs.io              | 1                     | 3.2%         | custom/unknown         |
| 12 | revopsroles.com           | 1                     | 3.2%         | custom/unknown         |
| 13 | climatebase.org           | 1                     | 3.2%         | custom/unknown         |
| 14 | jobs.oakhcft.com          | 1                     | 3.2%         | custom (company board) |
| 15 | talentify.io              | 1                     | 3.2%         | custom/unknown         |

## Top sources by HIGH-FIT roles (`fit_score >= 7`)

**138** high-fit roles across all hosts (11.0% of the pipeline).

| #  | host                     | high-fit | % of high-fit | hit rate on host | ATS                    |
|----|--------------------------|----------|---------------|------------------|------------------------|
| 1  | builtin.com              | 98       | 71.0%         | 24%              | BuiltIn (aggregator)   |
| 2  | jobs.ashbyhq.com         | 15       | 10.9%         | 24%              | Ashby                  |
| 3  | thesaraslist.com         | 7        | 5.1%          | 23%              | custom/unknown         |
| 4  | ycombinator.com          | 4        | 2.9%          | 80%              | YC Work at a Startup   |
| 5  | job-boards.greenhouse.io | 3        | 2.2%          | 11%              | Greenhouse             |
| 6  | builtinsf.com            | 2        | 1.4%          | 100%             | custom/unknown         |
| 7  | underprompt.com          | 2        | 1.4%          | 100%             | custom/unknown         |
| 8  | linkedin.com             | 1        | 0.7%          | 25%              | LinkedIn               |
| 9  | dailyremote.com          | 1        | 0.7%          | 100%             | custom/unknown         |
| 10 | community.clay.com       | 1        | 0.7%          | 33%              | custom/unknown         |
| 11 | builtinboston.com        | 1        | 0.7%          | 33%              | custom/unknown         |
| 12 | wfhverse.talk4fun.net    | 1        | 0.7%          | 100%             | custom/unknown         |
| 13 | sailonchain.com          | 1        | 0.7%          | 50%              | custom/unknown         |
| 14 | jobs.generalcatalyst.com | 1        | 0.7%          | 2%               | custom (company board) |

## ATS classification (rolled up across all sources)

| ATS                    | roles | % pipeline | high-fit | % high-fit | applied | % applied |
|------------------------|-------|------------|----------|------------|---------|-----------|
| BuiltIn (aggregator)   | 411   | 32.9%      | 98       | 71.0%      | 29      | 93.5%     |
| RevOpsCareers (custom) | 335   | 26.8%      | 0        | 0.0%       | 0       | 0.0%      |
| custom/unknown         | 289   | 23.1%      | 16       | 11.6%      | 22      | 71.0%     |
| custom (company board) | 112   | 9.0%       | 1        | 0.7%       | 2       | 6.5%      |
| Ashby                  | 62    | 5.0%       | 15       | 10.9%      | 27      | 87.1%     |
| Greenhouse             | 31    | 2.5%       | 3        | 2.2%       | 4       | 12.9%     |
| YC Work at a Startup   | 5     | 0.4%       | 4        | 2.9%       | 0       | 0.0%      |
| LinkedIn               | 4     | 0.3%       | 1        | 0.7%       | 0       | 0.0%      |
| Workable               | 1     | 0.1%       | 0        | 0.0%       | 0       | 0.0%      |
| Teamtailor             | 1     | 0.1%       | 0        | 0.0%       | 0       | 0.0%      |

## Recommendation — domain skills to build first

**By raw pipeline volume:**
- BuiltIn (aggregator) — 411 roles (32.9%)
- RevOpsCareers (custom) — 335 roles (26.8%)
- custom/unknown — 289 roles (23.1%)
- custom (company board) — 112 roles (9.0%)
- Ashby — 62 roles (5.0%)

**By applied roles:**
- BuiltIn (aggregator) — 29 applied (93.5%)
- Ashby — 27 applied (87.1%)
- custom/unknown — 22 applied (71.0%)
- Greenhouse — 4 applied (12.9%)
- custom (company board) — 2 applied (6.5%)

**By high-fit roles:**
- BuiltIn (aggregator) — 98 high-fit (71.0%)
- custom/unknown — 16 high-fit (11.6%)
- Ashby — 15 high-fit (10.9%)
- YC Work at a Startup — 4 high-fit (2.9%)
- Greenhouse — 3 high-fit (2.2%)

**Composite ranking (applied×3 + high-fit×2 + raw×1):**

1. **BuiltIn (aggregator)** — composite 694 (raw 411 · high-fit 98 · applied 29)
   - 93.5% of my applications flow through here.
   - 71.0% of my high-fit roles surface here.
2. **custom/unknown** — composite 387 (raw 289 · high-fit 16 · applied 22)
   - 71.0% of my applications flow through here.
   - 11.6% of my high-fit roles surface here.
3. **RevOpsCareers (custom)** — composite 335 (raw 335 · high-fit 0 · applied 0)
4. **Ashby** — composite 173 (raw 62 · high-fit 15 · applied 27)
   - 87.1% of my applications flow through here.
   - 10.9% of my high-fit roles surface here.
5. **custom (company board)** — composite 120 (raw 112 · high-fit 1 · applied 2)
   - 6.5% of my applications flow through here.
   - 0.7% of my high-fit roles surface here.

## Notes & caveats

- **BuiltIn is an aggregator, not an ATS.** Roles surfaced via BuiltIn ultimately redirect to the underlying ATS (Greenhouse, Lever, Ashby, etc.). For AutoApply, what matters is the *destination* form, not BuiltIn itself — so prioritize the destination ATS systems above BuiltIn even if BuiltIn drives raw discovery volume.
- The "custom (company board)" bucket is a mix — jobs.foo.com / careers.foo.com — many of which are wrappers around a real ATS. Worth a one-off pass to deepen the classification, but every one is a snowflake.
- Application↔URL matching is imperfect; companies that appear in applications.md but with different naming than in seen-urls.json don't get counted. The "applied" tallies are a *lower bound*.
- fit_score scale in this dataset is 1–9 (no 0, 5, or 10 observed). Threshold 7 = "high-fit" per CareerOps DESIGN.md convention.
