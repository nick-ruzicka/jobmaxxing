
## Location classification — deferred from the hybrid-CA fix (2026-05-13)

- **International metro sub-clustering.** `clusterForLocation()` currently lumps all non-US
  cities into `other_intl`. Add London area / GTA (Toronto) / Dublin / Berlin / Bengaluru
  etc. as first-class clusters in `scripts/lib/location-clusters.mjs` (`METRO_CLUSTERS`),
  with the dashboard chips following automatically.
- **User-configurable metro clusters.** If the search base changes (move, or expand to a
  second metro), the cluster the dashboard treats as "in scope" should be config-driven —
  e.g. `config/profile.yml: location.in_scope_clusters: [nyc, remote]`, read by
  `dashboard-web/lib/location-clusters.ts` consumers and the stat strip, instead of NYC
  being hard-coded as the `in-scope` tone in `CLUSTER_META`.
- **JD re-fetch for the still-`unknown` remainder.** `backfill-locations.mjs` works from
  cached signals only. The roles it leaves as `unknown` / `"Hybrid (location unclear)"`
  could be resolved by re-fetching the JD (JSON-LD `jobLocation` + body) — fold into a
  future `enrich-roles.mjs --relocate` pass rather than a standalone fetcher.
- **NYC commute belt — Phase 11 expansion candidates.** Westchester (Yonkers, White Plains)
  and CT/NJ near-suburbs (Stamford, Princeton) are already in `METRO_CLUSTERS.nyc`. Also
  consider: Mount Vernon, New Rochelle, Garden City, Mineola, Tarrytown, Greenwich CT,
  Norwalk CT, New Brunswick NJ.

## career-ops upstream update

- `career-ops` upstream is at **v1.7.1**; this fork is on **v1.2.0**. Review santifer's
  changes (`node update-system.mjs check` shows the changelog) before merging into the
  `nick-career-ops` fork — there may be conflicts with the local dashboard / scan-pipeline
  customisations. Not urgent; do it on a quiet day.
