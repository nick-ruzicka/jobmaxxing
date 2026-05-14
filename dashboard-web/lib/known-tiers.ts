/**
 * known-tiers.ts — the scraper tiers we expect to see analytics for.
 *
 * Lives in its own file (no fs import) so client components can pull it in
 * without dragging the whole analytics data layer through Turbopack.
 *
 * Slugs here MUST exactly match what scripts/scan-jobs.mjs emits via
 * tierTimer() / recordExaCall() — anything that doesn't match shows up as
 * an "extra" card on /analytics with a raw slug label. If you change a
 * slug in scan-jobs.mjs, change it here too.
 *
 * Last synced against main:
 *   ed5ec48 fix(analytics): complete Exa instrumentation across all tiers
 *   a430953 feat(analytics): wire scan-jobs-instrumentation into scraper
 *
 * Tier 1 (Ashby/Greenhouse) and Tier 9 (BuiltIn) are NOT in this list —
 * they hit ATSes / scrape HTML directly without going through the Exa
 * wrapper, so they don't emit tier_id events yet. When their tierTimer()
 * wiring lands, add them back here.
 */

export interface KnownTier {
  tier_id: string;
  label: string;
  description: string;
}

export const KNOWN_TIERS: KnownTier[] = [
  {
    tier_id: "tier_2_exa",
    label: "Tier 2 · Exa broad",
    description: "Exa neural search across generic queries (the main Tier 2 call site)",
  },
  {
    tier_id: "tier_2_broad",
    label: "Tier 2 · Exa fallback",
    description: "Default slug used when a caller of exaSearch() doesn't pass one explicitly",
  },
  {
    tier_id: "tier_3_vc",
    label: "Tier 3 · VC portfolios",
    description: "Exa queries scoped to VC-portfolio hosts",
  },
  {
    tier_id: "tier_3_hn",
    label: "Tier 3 · HN",
    description: "Exa queries scoped to HN Who's Hiring threads",
  },
  {
    tier_id: "tier_4_gtm_club",
    label: "Tier 4 · GTM Engineers Club",
    description: "Exa keyword queries scoped to GTM Engineers Club",
  },
  {
    tier_id: "tier_4_revops_coop",
    label: "Tier 4 · RevOps Co-op",
    description: "Exa keyword queries scoped to RevOps Co-op",
  },
  {
    tier_id: "tier_5_social",
    label: "Tier 5 · Social",
    description: "Exa queries against social hiring-intent posts (env-flag gated)",
  },
  {
    tier_id: "tier_6_similar",
    label: "Tier 6 · Similar search",
    description: "Exa findSimilar from seed URLs (companies we already track)",
  },
  {
    tier_id: "tier_7_intent",
    label: "Tier 7 · Hiring intent",
    description: "Exa queries for pre-posting hiring signals",
  },
  {
    tier_id: "tier_8_deep",
    label: "Tier 8 · Deep search",
    description: "Exa deepSearch for harder-to-surface roles",
  },
  {
    tier_id: "tier_10_yc_keyword",
    label: "Tier 10 · YC",
    description: "workatastartup.com + ycombinator.com via Exa keyword",
  },
  {
    tier_id: "tier_11_vc_board",
    label: "Tier 11 · VC boards",
    description: "Getro/Consider SPA scrape of 5 VC portfolio boards",
  },
  {
    tier_id: "tier_12_google",
    label: "Tier 12 · Google-style",
    description: "Catches what Exa misses via broader queries",
  },
];
