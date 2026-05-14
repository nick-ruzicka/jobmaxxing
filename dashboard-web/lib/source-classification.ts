/**
 * source-classification.ts — TypeScript loader for the canonical AGGREGATOR_HOSTS /
 * EXCLUDE_DOMAINS lists. Pairs with `scripts/lib/source-classification.mjs`; both read
 * `config/source-classification.json`.
 *
 * Do NOT duplicate these arrays anywhere else. If you need them in another file, import
 * from here (TS) or from scripts/lib/source-classification.mjs (Node).
 */
import classification from "../../config/source-classification.json";

export const AGGREGATOR_HOSTS: readonly string[] = Object.freeze([
  ...classification.aggregator_hosts,
]);
export const EXCLUDE_DOMAINS: readonly string[] = Object.freeze([
  ...classification.exclude_domains,
]);

/** Subdomain-inclusive host membership test. Mirrors scripts/lib/source-classification.mjs. */
export function matchesHostList(host: string, list: readonly string[]): boolean {
  if (!host) return false;
  return list.some((h) => host === h || host.endsWith("." + h));
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export type SourceClassification = {
  type: "excluded" | "aggregator" | "unknown";
  host: string | null;
};

/**
 * Classify a URL by source. Excluded wins over aggregator (spam-block precedence).
 */
export function classifySource(url: string): SourceClassification {
  const host = hostnameOf(url);
  if (!host) return { type: "unknown", host: null };
  if (matchesHostList(host, EXCLUDE_DOMAINS)) return { type: "excluded", host };
  if (matchesHostList(host, AGGREGATOR_HOSTS)) return { type: "aggregator", host };
  return { type: "unknown", host };
}

export function isAggregatorHost(url: string): boolean {
  return classifySource(url).type === "aggregator";
}

export function isExcludedHost(url: string): boolean {
  return classifySource(url).type === "excluded";
}
