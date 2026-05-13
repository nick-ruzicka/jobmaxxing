// Pure chip-count computation for dashboard-web/components/FilterBar.
//
// Lives in scripts/lib/ rather than dashboard-web/ so node:test can exercise it
// without a TS toolchain. dashboard-web's tsconfig has
// `allowJs: true` + `moduleResolution: bundler`, so the .tsx FilterBar can
// import this .mjs directly.
//
// The key invariant we test: when `includeAggregator` is false (the default),
// every chip count *except aggCount itself* must compute over the non-
// aggregator subset of roles. Before this lived in a shared module, the chip
// counts in FilterBar.tsx looped over the unfiltered `roles` prop, inflating
// "NYC 260 / Remote 366 / Build 292 / AI 368" by however many aggregator
// roles happened to fall into each bucket — confusing because those roles
// were already hidden from the table below.
//
// `aggCount` continues to count over the full `roles` list so the aggregator
// toggle chip itself can show "off (N hidden)" with N being meaningful.

/**
 * @typedef {object} ChipCounts
 * @property {Record<string, number>} statusCounts   - per-status counts
 * @property {Record<string, number>} locBucketCounts - per-location-bucket counts
 * @property {number} buildCount  - roles with build_component enrichment
 * @property {number} aiCount     - roles with ai_signal enrichment
 * @property {number} compCount   - roles with comp data (either enrichment or scraped)
 * @property {number} staleCount  - stale roles
 * @property {number} aggCount    - aggregator-sourced roles (over FULL roles, not scope)
 */

/**
 * Compute chip counts.
 *
 * @param {Array<object>} roles - the full role set (caller does NOT pre-filter)
 * @param {object} [opts]
 * @param {boolean} [opts.includeAggregator=false] - if false, aggregator
 *   roles are excluded from every count except `aggCount`.
 * @param {(role: object) => string} [opts.bucketRole] - role → bucket-key
 *   function (defaults to `r => r.location`).
 * @returns {ChipCounts}
 */
export function computeChipCounts(roles, opts = {}) {
  const includeAggregator = opts.includeAggregator === true;
  const bucketRole = typeof opts.bucketRole === "function"
    ? opts.bucketRole
    : (r) => r?.location || "";

  // "Scope" = the role set the chips are *about*. When aggregators are
  // hidden, chips should describe what's visible — not what's stuffed in
  // the off-screen pile.
  const scope = includeAggregator
    ? roles
    : roles.filter((r) => r && r.source_tier !== "aggregator");

  const statusCounts = {};
  const locBucketCounts = {};
  let buildCount = 0;
  let aiCount = 0;
  let compCount = 0;
  let staleCount = 0;

  for (const r of scope) {
    if (!r) continue;
    if (r.status) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    const bucket = bucketRole(r);
    if (bucket) locBucketCounts[bucket] = (locBucketCounts[bucket] || 0) + 1;
    if (r.enrichment && r.enrichment.build_component) buildCount++;
    if (r.enrichment && r.enrichment.ai_signal) aiCount++;
    if (r.enrichment && r.enrichment.comp_range && r.enrichment.comp_range !== "Not listed") compCount++;
    if (r.comp) compCount++;
    if (r.stale) staleCount++;
  }

  // aggCount is special — it's the value the aggregator-toggle chip itself
  // displays, so it must always reflect "how many aggregator roles exist
  // in the unfiltered pipeline" regardless of the toggle state.
  let aggCount = 0;
  for (const r of roles) {
    if (r && r.source_tier === "aggregator") aggCount++;
  }

  return { statusCounts, locBucketCounts, buildCount, aiCount, compCount, staleCount, aggCount };
}
