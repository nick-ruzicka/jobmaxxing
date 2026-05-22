# E6 — Web3 magnitude divergence: decision record (2026-05-22)

**Status: CLOSED — no action.** This is a decision record, not a change. No scoring values move.

## The item

E6 (from the Category-E scoring audit) flagged that the institutional-Web3 boost and title-signal magnitudes differ between the two scoring stages:

| weight | classifier | scoring-layer |
|---|---|---|
| Web3 stablecoin_tier | 60 | 35 |
| Web3 tier_1 | 20 | 12 |
| Web3 tier_2 | 10 | 6 |
| title high_match | 100 | 8 |
| title medium_match | 50 | 4 |
| title low_match | 20 | — |

The concern (pre-PR #23): the two looked coupled — both read the same `institutional_companies_boost` company lists from `config/archetypes.yaml` — but emitted different numbers, which read like silent "math drift."

## Why it's closed as no-action

**1. The structural concern was already resolved by PR #23.** Both sets of magnitudes were extracted into one module (`scripts/lib/scoring-weights.mjs`), so the divergence is now visible and tunable in one place. There is no longer a hidden copy that can drift.

**2. The proportions are consistent; only the absolute scale differs — by design.**

- tier_1 : tier_2 — **2 : 1 in both** (20/10 and 12/6)
- title high : medium — **2 : 1 in both** (100/50 and 8/4)
- stablecoin : tier_2 — **6.0** (classifier) vs **5.83** (scoring-layer) — a 3% difference, noise

The absolute scales are *supposed* to differ because the two stages do different jobs:
- **classifier** produces a `raw_score` that saturates toward `SATURATION_POINT = 100` (`fitness = raw_score / 100`) — it's deciding *which archetype* a role is.
- **scoring-layer** adds a small fit-score *uplift* capped by `ARCHETYPE_REWARD_CAP = 25` — it's nudging an already-decided role's 0–10 fit.

A 60-point classifier boost and a 35-point scoring-layer boost are the same *relative* signal expressed on two different scales. Forcing them to identical numbers would be wrong — it would distort one of the two stages.

## What would reopen this

Changing the *ratios* (e.g. deciding stablecoin should be 8× tier_2 instead of 6×, or that title signals should weigh more relative to company boosts) is a **scoring-math/product decision**, not a cleanup refactor. It would require its own dry-run + corpus re-score (California-fix rails), the same as E7. There is no such decision pending.

## Category E — final state

| item | resolution |
|---|---|
| E1 California `"ca"`=Canada | shipped (PR #5) |
| E2 `global_disqualifiers.location` unread | shipped (PR #15) |
| E3 dashboard reads `score_adjusted` | shipped (PR #12) |
| E4 floor-clamp observability | shipped (PR #24) + corpus re-score (PR #25) |
| E5 trust-gate ceiling cap | shipped (PR #13/#14) |
| E7 override-path unification | shipped (PR #26) |
| **E6 magnitude divergence** | **closed, no action (this doc)** |

With E6 closed, the Category-E scoring-correctness track is complete. Remaining magnitude/ratio tuning, if ever desired, is new product work, not cleanup.
