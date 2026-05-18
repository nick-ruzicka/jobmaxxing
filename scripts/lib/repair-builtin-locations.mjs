// repair-builtin-locations.mjs — one-shot repair for existing seen-urls.json
// entries from BuiltIn whose card-scrape left location_city=null (or
// location_workplace=unknown). The BuiltIn JOB PAGE has rich JSON-LD with full
// jobLocation array + baseSalary that the card-time scrape never sees.
//
// Mirror of repair-ats-locations.mjs but for builtin.com URLs. Shares the same
// upgradeBuiltinResult primitive that scan-jobs.mjs STEP 0b uses on every new
// scrape — this just applies it retroactively to historical entries.
//
// Run once after a STEP 0b deployment to catch the historical pile. Same
// lifecycle as the other archived one-shot scripts in scripts/archive/.
//
// Note: BuiltIn rate-limits aggressively. A bulk run of 400+ URLs may hit
// HTTP 403 partway through. The CLI surfaces upgrade_failed counts so you can
// re-run later for the failures.

import { detectBuiltinUrl, upgradeBuiltinResult } from "./builtin-jsonld-upgrade.mjs";

/**
 * Walk a seen-urls dict and upgrade any entry that:
 *   (a) is keyed by a builtin.com/job/... URL
 *   (b) has location_city missing OR location_workplace missing/"unknown"
 *
 * Mutates `seen` in place when `dryRun` is false. Returns stats + previews
 * (preview-only when dryRun).
 *
 * @param {object} seen
 * @param {object} [options]
 * @param {Function} [options.fetch]                              - injectable fetcher
 * @param {{preferred: string[], avoid: string[]}} [options.preferences]
 * @param {boolean} [options.dryRun]
 * @returns {{stats: object, previews: Array<{url, upgraded}>}}
 */
export async function repairBuiltinLocations(seen, options = {}) {
  const stats = {
    scanned: 0,
    upgraded: 0,
    skipped_already_known: 0,
    skipped_non_builtin: 0,
    upgrade_failed: 0,
  };
  const previews = [];

  for (const [url, entry] of Object.entries(seen)) {
    stats.scanned++;
    if (!detectBuiltinUrl(url)) {
      stats.skipped_non_builtin++;
      continue;
    }
    // Trigger logic matches upgradeBuiltinResult's: city missing is the real
    // bug signal. Workplace=unknown also qualifies. If both are set to real
    // values, the entry is already good.
    const cityMissing = !entry || !entry.location_city;
    const workplaceUnknown = !entry || !entry.location_workplace || entry.location_workplace === "unknown";
    if (!cityMissing && !workplaceUnknown) {
      stats.skipped_already_known++;
      continue;
    }

    const upgraded = await upgradeBuiltinResult({ ...entry, url }, options);
    if (upgraded.location_upgraded_from !== "builtin_jsonld") {
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
