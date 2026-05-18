// repair-ats-locations.mjs — one-shot repair for existing seen-urls.json entries
// that landed with location_workplace="unknown" despite being from a known ATS.
//
// Built to cover the gap surfaced by the Gumloop investigation (2026-05-18): when
// Tier-8 Exa deep-search discovered an Ashby URL with no location keywords in its
// snippet, the entry was persisted with workplace="unknown" forever. New scrapes
// now fix this at write-time (see scan-jobs.mjs STEP 0); this script fixes the
// historical entries that already exist.
//
// Run once after deploying the STEP 0 upgrade, then archive alongside the other
// one-shot scripts in scripts/archive/.

import { detectAtsUrl, upgradeAtsResult } from "./ats-url-upgrade.mjs";

/**
 * Walk a seen-urls dict and upgrade any entry that:
 *   (a) is keyed by a known-ATS URL (jobs.ashbyhq.com/* or boards.greenhouse.io/*)
 *   (b) has location_workplace missing or "unknown"
 *
 * Mutates `seen` in place when `dryRun` is false. Returns stats + previews
 * (preview-only when dryRun).
 *
 * @param {object} seen                     - the seen-urls.json contents
 * @param {object} [options]
 * @param {Function} [options.fetch]        - injectable fetcher (default globalThis.fetch)
 * @param {boolean} [options.dryRun]        - when true, do not mutate seen
 * @returns {{stats: object, previews: Array<{url, upgraded}>}}
 */
export async function repairAtsLocations(seen, options = {}) {
  const stats = {
    scanned: 0,
    upgraded: 0,
    skipped_already_known: 0,
    skipped_non_ats: 0,
    upgrade_failed: 0,
  };
  const previews = [];

  for (const [url, entry] of Object.entries(seen)) {
    stats.scanned++;
    if (!detectAtsUrl(url)) {
      stats.skipped_non_ats++;
      continue;
    }
    if (entry && typeof entry.location_workplace === "string" && entry.location_workplace !== "unknown" && entry.location_workplace !== "") {
      stats.skipped_already_known++;
      continue;
    }

    const upgraded = await upgradeAtsResult({ ...entry, url }, options);
    if (upgraded.location_upgraded_from !== "ats_api") {
      stats.upgrade_failed++;
      continue;
    }
    stats.upgraded++;

    // Strip `url` from the merge — it's the seen-urls KEY, not an entry field.
    const { url: _u, ...mergeFields } = upgraded;
    if (options.dryRun) {
      previews.push({ url, upgraded: mergeFields });
    } else {
      Object.assign(seen[url], mergeFields);
    }
  }

  return { stats, previews };
}
