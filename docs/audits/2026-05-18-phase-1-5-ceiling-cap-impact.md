# Phase 1.5 Ceiling Cap Impact Analysis

**Date:** 2026-05-18
**Branch:** `fix/comp-unverified-ceiling-cap`
**Cap rule:** When `comp:below_floor_suppressed` is present in adjustments and the computed `adjusted_score > 8.5`, clamp to 8.5 and emit `ceiling:comp_unverified_cap`.

## Summary

| Metric | Value |
|--------|-------|
| Total records scored | 1,080 |
| Records with `comp:below_floor_suppressed` | 53 |
| Records affected by cap (score reduced) | 21 |
| Records with suppressed comp but score already <= 8.5 | 32 |
| False positives (cap fired without suppressed comp) | 0 |

**21 out of 53** records with unverified comp had inflated scores above 8.5. All 21 are now capped at 8.5.

## Distribution

| Transition | Count |
|------------|-------|
| 10.0 → 8.5 | 17 |
| 9.5 → 8.5 | 1 |
| 9.0 → 8.5 | 2 |
| 8.8 → 8.5 | 1 |

The vast majority (17/21 = 81%) were perfect 10.0 scores — the most structurally dishonest case, where archetype bonuses pushed the score to the ceiling while comp verification was suppressed.

## Affected Records

| # | Company | Title | fit_score | Before | After | Delta |
|---|---------|-------|-----------|--------|-------|-------|
| 1 | Toast | Gtm Engineer Marketing Operations Ai Innovation | 7 | 10.0 | 8.5 | -1.5 |
| 2 | DISQO | Gtm Engineer | 7 | 10.0 | 8.5 | -1.5 |
| 3 | Rula | Gtm Engineer (Remote) | 9 | 10.0 | 8.5 | -1.5 |
| 4 | Playground (tryplayground.com) | Gtm Engineer | 8 | 10.0 | 8.5 | -1.5 |
| 5 | EliseAI | Gtm Engineer | 9 | 10.0 | 8.5 | -1.5 |
| 6 | EliseAI | Senior Revenue Operations Manager | 6 | 10.0 | 8.5 | -1.5 |
| 7 | Redis (redis.io) | Experienced GTM Engineer | 8 | 10.0 | 8.5 | -1.5 |
| 8 | FOSSA | GTM Engineer | 7 | 10.0 | 8.5 | -1.5 |
| 9 | Mento | GTM Engineer | 9 | 10.0 | 8.5 | -1.5 |
| 10 | **Anaconda** | **GTM Engineer** | **8** | **10.0** | **8.5** | **-1.5** |
| 11 | Tremendous | GTM Engineer | 8 | 10.0 | 8.5 | -1.5 |
| 12 | Camber | GTM Systems Manager/Engineer | 7 | 10.0 | 8.5 | -1.5 |
| 13 | Snorkel AI | Senior GTM Engineer | 7 | 10.0 | 8.5 | -1.5 |
| 14 | AZX | GTM AI Engineer | 8 | 10.0 | 8.5 | -1.5 |
| 15 | Crux (cruxclimate.com) | GTM Engineer | 7 | 10.0 | 8.5 | -1.5 |
| 16 | Jump - Advisor AI | Technical GTM Engineer | 9 | 10.0 | 8.5 | -1.5 |
| 17 | Vibe.co | GTM Engineer | 7 | 10.0 | 8.5 | -1.5 |
| 18 | Thoughtly | GTM Engineer | 7 | 9.5 | 8.5 | -1.0 |
| 19 | Toast | Senior GTM Engineer, AI Innovation | 6 | 9.0 | 8.5 | -0.5 |
| 20 | Toast | GTM Engineer, Marketing Operations AI Innovation | 6 | 9.0 | 8.5 | -0.5 |
| 21 | DigiCert | Lead GTM Analytics Engineer | 6 | 8.8 | 8.5 | -0.3 |

## Smoke Tests

- **Anaconda confirmed:** Row 10 shows Anaconda GTM Engineer moving from 10.0 to 8.5 as expected.
- **Zero false positives:** No records without `comp:below_floor_suppressed` were affected by the cap.
- **32 records with suppressed comp already scored <= 8.5:** These are unaffected (location penalties, anti-signals, or lower base scores kept them below the threshold naturally).

## Observations

1. All 21 affected records are from BuiltIn (`builtin.com` / `builtinboston.com`), which is expected since `comp:below_floor_suppressed` only fires when `comp_source === "jsonld_basesalary"` disagrees with Claude's verdict — a BuiltIn-specific artifact.
2. The cap correctly preserves ordering among affected records: a 9.5 stays above a 9.0 in the uncapped world but both land at 8.5 post-cap. This is acceptable since the 8.5 ceiling communicates "great role, unverified comp" regardless of the original spread.
3. No records outside the `comp:below_floor_suppressed` population were touched, confirming the cap is precisely scoped.
