// Centralized scoring magnitudes. Previously scattered across scoring-layer.mjs
// (Web3 35/12/6, title 8/4) and archetype-classifier.mjs (Web3 60/20/10, title
// 100/50/20). Co-locating them makes the intentional divergence visible and
// tunable in one place.
//
// IMPORTANT: the classifier weights and scoring-layer weights are DELIBERATELY
// different magnitudes — the classifier saturates toward 100 (fitness = score /
// SATURATION_POINT), while the scoring layer adds a smaller fit-score uplift
// (capped by ARCHETYPE_REWARD_CAP). Do NOT "reconcile" them to the same numbers
// without an explicit scoring-math decision (cleanup item E6). This module is a
// structural extraction only — values are unchanged from their previous inline
// literals.

// Institutional Web3 company boost. stablecoin_tier = strong (Paxos, Circle,
// BitGo, Anchorage, Tether); tier_1 = institutional-but-not-stablecoin; tier_2
// = DeFi (minimal).
export const INSTITUTIONAL_BOOST = {
  classifier: { stablecoin_tier: 60, tier_1: 20, tier_2: 10 },
  scoringLayer: { stablecoin_tier: 35, tier_1: 12, tier_2: 6 },
};

// Title-signal match bonus.
export const TITLE_SIGNAL_WEIGHTS = {
  classifier: { high_match: 100, medium_match: 50, low_match: 20 },
  scoringLayer: { high_match: 8, medium_match: 4 },
};
