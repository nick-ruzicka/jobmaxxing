/**
 * known-tiers.ts — the 12 tiers the scraper runs through.
 *
 * Lives in its own file (no fs import) so client components can pull it in
 * without dragging the whole analytics data layer through Turbopack.
 *
 * KEEP IN SYNC with scripts/lib/scan-jobs-instrumentation.mjs once the
 * wiring lands in scripts/scan-jobs.mjs. The tier_id values are the labels
 * tierTimer() should emit.
 */

export interface KnownTier {
  tier_id: string;
  label: string;
  description: string;
}

export const KNOWN_TIERS: KnownTier[] = [
  {
    tier_id: "tier_1_ashby",
    label: "Tier 1 · Ashby API",
    description: "Per-company API to api.ashbyhq.com (24 slugs)",
  },
  {
    tier_id: "tier_1_greenhouse",
    label: "Tier 1 · Greenhouse API",
    description: "Per-company API to boards-api.greenhouse.io (14 slugs)",
  },
  {
    tier_id: "tier_2_broad",
    label: "Tier 2 · Exa broad",
    description: "Exa neural search across generic queries",
  },
  {
    tier_id: "tier_3_vc_hn",
    label: "Tier 3 · VC + HN",
    description: "Exa queries scoped to VC portfolios + HN Who's Hiring",
  },
  {
    tier_id: "tier_4_gtm_revops",
    label: "Tier 4 · GTM/RevOps",
    description: "GTM Engineers Club + RevOps Co-op (Exa keyword)",
  },
  {
    tier_id: "tier_5_social",
    label: "Tier 5 · Social",
    description: "Exa queries against social hiring intent posts",
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
    tier_id: "tier_9_builtin",
    label: "Tier 9 · BuiltIn",
    description: "Direct scrape of builtin.com/jobs across 10 search terms × 2 pages",
  },
  {
    tier_id: "tier_10_yc",
    label: "Tier 10 · YC",
    description: "workatastartup.com + ycombinator.com via Exa keyword",
  },
  {
    tier_id: "tier_11_vc_boards",
    label: "Tier 11 · VC boards",
    description: "Getro/Consider SPA scrape of 5 VC portfolio boards",
  },
  {
    tier_id: "tier_12_google",
    label: "Tier 12 · Google-style",
    description: "Catches what Exa misses via broader queries",
  },
];
