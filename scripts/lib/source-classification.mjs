/**
 * source-classification.mjs — canonical AGGREGATOR_HOSTS / EXCLUDE_DOMAINS source of truth.
 *
 * Reads `config/source-classification.json`. Both this module and
 * `dashboard-web/lib/source-classification.ts` import that same JSON, eliminating the
 * drift that built up across scan-jobs.mjs, scan-signals.mjs, generate-pipeline-health.mjs,
 * rescan-locations.mjs, dashboard-web/lib/data.ts, and dashboard-web/lib/source-health.ts.
 *
 * Subdomain-inclusive matching is the convention everywhere downstream — hosts in
 * either list match both exact (host === entry) and subdomain (host.endsWith("." + entry)).
 * Keep that semantics consistent in any new consumers.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "..", "config", "source-classification.json");

const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

/** Re-syndicator hosts. Quarantined in source-health classification; hidden by default in the UI. */
export const AGGREGATOR_HOSTS = Object.freeze([...parsed.aggregator_hosts]);

/** Content-farm / SEO-spam hosts. Blocked at scan time (Exa excludeDomains + NON_JOB_URL_PATTERNS). */
export const EXCLUDE_DOMAINS = Object.freeze([...parsed.exclude_domains]);

/**
 * Subdomain-inclusive host membership test. Returns true if `host` is exactly an entry in
 * `list` or is a strict subdomain of one (host.endsWith("." + entry)).
 */
export function matchesHostList(host, list) {
  if (!host) return false;
  return list.some((h) => host === h || host.endsWith("." + h));
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify a URL by source.
 *
 * @param {string} url
 * @returns {{ type: 'excluded' | 'aggregator' | 'unknown', host: string | null }}
 *   - 'excluded'   — host is in EXCLUDE_DOMAINS (spam-blocked at scan time).
 *   - 'aggregator' — host is in AGGREGATOR_HOSTS (quarantined re-syndicator).
 *   - 'unknown'    — neither. The caller decides ATS-vs-company-direct from other signals
 *                    (URL pattern matching against ats-slug-extractor.mjs, etc.).
 *
 * Excluded wins over aggregator (a host could appear in both lists; spam-block takes precedence).
 */
export function classifySource(url) {
  const host = hostnameOf(url);
  if (!host) return { type: "unknown", host: null };
  if (matchesHostList(host, EXCLUDE_DOMAINS)) return { type: "excluded", host };
  if (matchesHostList(host, AGGREGATOR_HOSTS)) return { type: "aggregator", host };
  return { type: "unknown", host };
}

/** Convenience: true if URL's host is in AGGREGATOR_HOSTS (subdomain-inclusive). */
export function isAggregatorHost(url) {
  return classifySource(url).type === "aggregator";
}

/** Convenience: true if URL's host is in EXCLUDE_DOMAINS (subdomain-inclusive). */
export function isExcludedHost(url) {
  return classifySource(url).type === "excluded";
}
