# Archived Scripts

One-time migration and backfill scripts that have completed their purpose.
Kept for reproducibility — the data they produced still lives in `data/`.

## Scripts

### backfill-analytics-from-state.mjs
Reconstructs daily analytics rollups from the application state file for dates
before the event-log system was introduced. Last committed: 2026-05-14.
Reproducibility: rollup data lives in `data/analytics/`.

### backfill-archetypes.mjs
Assigns archetype tags to existing entries in `seen-urls.json` that predate
the automatic archetype classification added to the scan pipeline.
Last committed: 2026-05-16.
Reproducibility: archetype fields in `data/seen-urls.json`.

### backfill-jd-quality.mjs
Applies `assessVerdictForExisting()` to every entry in `seen-urls.json`,
backfilling JD quality verdicts for roles scanned before quality scoring
was added. Last committed: 2026-05-16.
Reproducibility: `jd_quality` fields in `data/seen-urls.json`.

### backfill-locations.mjs
Upgrades location data for ~1228 existing entries from cached strings to
structured `{workplace, city, region}` format using the location-clusters
system. Last committed: 2026-05-13.
Reproducibility: structured location fields in `data/seen-urls.json`;
report in `reports/backfill-locations-*.md`.

### check-location-reclassification.mjs
Simulates location classification rules against stored data to verify
reclassification accuracy before applying changes. Diagnostic/validation
tool. Last committed: 2026-05-12.

### migrate-seen-urls.mjs
One-time migration to re-extract company names in `seen-urls.json`.
Supports `--dry-run` (default) and `--apply`. Last committed: 2026-05-12.
Reproducibility: company fields in `data/seen-urls.json`.

### prune-stale.mjs
Removes stale (expired/closed) roles from `seen-urls.json`. Supports
`--dry-run` (default) and `--apply`. Last committed: 2026-05-12.
Reproducibility: pruned entries are gone; remaining entries in `data/seen-urls.json`.

### rescan-locations.mjs
Re-scrapes job pages to resolve `unknown` or `Hybrid (location unclear)`
location entries. Supports `--dry-run`, `--concurrency`, `--filter`,
`--limit`. Last committed: 2026-05-14.
Reproducibility: updated location fields in `data/seen-urls.json`.
