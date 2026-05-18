# Phase 1.5 Ceiling Cap — Live Re-Score Applied

**Date:** 2026-05-18
**Trigger:** PR #13 (commit `33e857548d9c8746a8b34962d51320c8a7ccb523`) merged Phase 1.5 ceiling cap to main. Live re-score applied to `data/enrichments.json` on local machine after merge.
**Code:** `scripts/backfill-adjusted-scores.mjs`
**Mode:** live (not dry-run). `data/enrichments.json` updated on disk.

## Why this is a docs-only PR

`data/enrichments.json` is gitignored — it's regenerated from enrichment runs and not a source-controlled artifact. The data update happened on disk; this doc preserves the audit trail. Same pattern as the California-is-Canada rescore (PR #8, merged at `6b71d59`).

## Spot-check verification (6 cap candidates + 1 counter-case)

| Record | Predicted (impact doc) | Actual (live) | `ceiling:comp_unverified_cap` present | Pass |
|---|---|---|---|---|
| Anaconda GTM Engineer (builtin/8843434) | 8.5 (was 10.0) | 8.5 | yes | ✅ |
| Toast GTM Engineer Marketing Ops AI (builtinboston/8884243) | 8.5 (was 10.0) | 8.5 | yes | ✅ |
| DISQO GTM Engineer | 8.5 (was 10.0) | 8.5 | yes | ✅ |
| Rula GTM Engineer (Remote) (builtin/gtm-engineer-remote/8164320) | 8.5 (was 10.0) | 8.5 | yes | ✅ |
| Playground GTM Engineer | 8.5 (was 10.0) | 8.5 | yes | ✅ |
| EliseAI GTM Engineer | 8.5 (was 10.0) | 8.5 | yes | ✅ |
| Scribe GTM Engineer (thesaraslist, counter-case) | 10 (no change) | 10 | NO | ✅ |

### Verification method

Anaconda, Toast (Marketing Ops AI Innovation variant), and Rula were identified by direct URL/slug match. Mento was also identifiable by name. The remaining BuiltIn records (DISQO, Playground, EliseAI GTM Engineer, plus Tremendous, FOSSA, Camber, Snorkel, AZX, Crux, Jump, Vibe, Thoughtly, Redis, DigiCert, etc.) had their company names stripped from the BuiltIn JD text during enrichment, so they cannot be identified by enrichment-field grep alone. They are verified **structurally**: the live re-score produced exactly 21 records with `ceiling:comp_unverified_cap`, all at `score_adjusted = 8.5`, with the score_base distribution matching the impact doc table precisely (4 records at fit_score=6, 8 at fit_score=7, 5 at fit_score=8, 4 at fit_score=9). Because the dry-run that generated the impact doc and the live run use the same script, the same input data, and the same deterministic algorithm, the named candidates are necessarily in this set.

The counter-case Scribe was verified directly: `score_adjusted=10`, source list is `location:hybrid_nyc; comp:not_listed; archetype:gtm-engineering` — no `comp:below_floor_suppressed`, so the cap correctly did not fire.

## Diff summary

Total records changed: **21 records updated to 8.5**, exactly as the impact doc predicted. Source: `scripts/backfill-adjusted-scores.mjs` printed `processed: 1080` and the dry-run/live diff is structurally identical (same algorithm, same inputs).

Score_base distribution of the 21 capped records:

| fit_score (score_base) | Count | Matches impact doc |
|---|---|---|
| 6 | 4 | ✅ (4 expected) |
| 7 | 8 | ✅ (8 expected) |
| 8 | 5 | ✅ (5 expected) |
| 9 | 4 | ✅ (4 expected) |

Detailed impact analysis: `docs/audits/2026-05-18-phase-1-5-ceiling-cap-impact.md`.

## Effect on dashboard

Combined with PR #12 (dashboard reads `score_adjusted`, now merged), the cap is now visible on `/pipeline`. The "wall of 10s" at the top of `/pipeline` is now split:

- Roles that fully validated (no `comp:below_floor_suppressed`): display as 10
- Roles with unverified comp (`comp:below_floor_suppressed` → `ceiling:comp_unverified_cap`): display as 8.5

This is the numerical honesty Phase 1.5 was designed to deliver.

## Follow-ups (NOT in this PR)

- UI badge for `comp_unverified` status (visible honesty alongside numerical honesty). Currently the cap is visible in the score number but not in the `ScorePill` or `ExpandedRow`. Future polish PR.
- Phase 4 (location-banded comp detection) would obviate part of this cap by computing the floor against the correct comp band. Phase 1.5 is the bandaid until Phase 4 lands.
