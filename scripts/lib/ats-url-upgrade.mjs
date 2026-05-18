// ats-url-upgrade.mjs — when a result is discovered via a generic tier (e.g. Tier 8
// Exa deep search) but its URL is transparently from a known ATS (Ashby, Greenhouse),
// re-fetch the structured posting from the ATS API so location/company/comp are clean
// instead of parsed-from-HTML-title.
//
// This closes the gap where a `jobs.ashbyhq.com/{slug}/{jobId}` URL discovered via web
// search ends up with `location_workplace="unknown"` (because Exa's text snippet didn't
// contain workplace keywords) and `company="Jobs"` (because Ashby's HTML <title> ends
// with " - Jobs" and the title-parser grabs the last token). Both are one API call away.

import { structuredLocationFields } from "./location.mjs";

const ASHBY_URL_RE = /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/;
// Both classic boards.greenhouse.io and the newer job-boards.greenhouse.io.
const GREENHOUSE_URL_RE = /^https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/([^/?#]+)/;

/**
 * Detect whether a URL is from a known ATS we can re-fetch structured data from.
 * Returns `{ats, slug, jobId}` or `null`.
 */
export function detectAtsUrl(url) {
  if (!url || typeof url !== "string") return null;
  const a = url.match(ASHBY_URL_RE);
  if (a) return { ats: "ashby", slug: a[1], jobId: a[2] };
  const g = url.match(GREENHOUSE_URL_RE);
  if (g) return { ats: "greenhouse", slug: g[1], jobId: g[2] };
  return null;
}

/**
 * Slug → display company. Mirrors the convention used in scan-jobs.mjs scanAshby/scanGreenhouse:
 * uppercase first char, replace hyphens with spaces. "hebbia-ai" → "Hebbia ai", "Gumloop" → "Gumloop".
 */
function companyFromSlug(slug) {
  if (!slug) return "";
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
}

/**
 * Format Ashby's compensation payload into the short "$200K-$265K" string the rest of
 * the pipeline expects. Tries summary-string first (already human-formatted), falls
 * back to numeric extraction across the few shapes Ashby has shipped.
 */
function formatAshbyComp(compensation) {
  if (!compensation || typeof compensation !== "object") return "";
  // Preferred: pre-formatted summary string from Ashby itself.
  if (typeof compensation.compensationTierSummary === "string" && compensation.compensationTierSummary.trim()) {
    return compensation.compensationTierSummary.trim();
  }
  if (typeof compensation.scrapeableCompensationSalarySummary === "string" && compensation.scrapeableCompensationSalarySummary.trim()) {
    return compensation.scrapeableCompensationSalarySummary.trim();
  }
  // Newer shape: summaryComponents[0].{minValue,maxValue}.
  const summary = Array.isArray(compensation.summaryComponents) ? compensation.summaryComponents[0] : null;
  if (summary && summary.minValue && summary.maxValue) {
    return `$${Math.round(summary.minValue / 1000)}K-$${Math.round(summary.maxValue / 1000)}K`;
  }
  // Tiered shape: compensationTiers[0].components[0].{minValue,maxValue}.
  const tier = Array.isArray(compensation.compensationTiers) ? compensation.compensationTiers[0] : null;
  const tierComp = tier && Array.isArray(tier.components) ? tier.components[0] : null;
  if (tierComp && tierComp.minValue && tierComp.maxValue) {
    return `$${Math.round(tierComp.minValue / 1000)}K-$${Math.round(tierComp.maxValue / 1000)}K`;
  }
  // Legacy flat shape that scanAshby reads directly.
  if (compensation.min && compensation.max) {
    return `$${Math.round(compensation.min / 1000)}K-$${Math.round(compensation.max / 1000)}K`;
  }
  return "";
}

/**
 * Map an Ashby posting-API job → the partial result fields we want to replace on a
 * pre-existing record discovered via a generic tier.
 */
export function upgradeFromAshbyJob(job, slug) {
  const loc = job.location || "";
  return {
    title: job.title || "",
    company: companyFromSlug(slug),
    ...structuredLocationFields(loc, !!job.isRemote, job.workplaceType || null),
    comp: formatAshbyComp(job.compensation),
  };
}

/**
 * Map a Greenhouse boards-API job → the partial result fields we want to replace.
 * Greenhouse exposes only a `location.name` string and no workplaceType, so we hand
 * structuredLocationFields a null workplaceType (matches scanGreenhouse's existing call).
 */
export function upgradeFromGreenhouseJob(job, slug) {
  const loc = (job.location && job.location.name) || "";
  return {
    title: job.title || "",
    company: companyFromSlug(slug),
    ...structuredLocationFields(loc, false, null),
    comp: "", // Greenhouse boards API doesn't expose comp
  };
}

/**
 * Orchestrator. If `result.url` is from a known ATS AND `result.location_workplace` is
 * "unknown" or missing, fetch the API and replace location/company/title/comp.
 * Returns the upgraded record (a new object) — or the original record on any failure
 * or passthrough. Never throws.
 *
 * @param {object} result          - existing result record (must have .url)
 * @param {object} [options]
 * @param {Function} [options.fetch]  - injectable fetcher (defaults to globalThis.fetch)
 */
export async function upgradeAtsResult(result, options = {}) {
  if (!result || typeof result !== "object") return result;
  if (result.location_workplace && result.location_workplace !== "unknown") return result;

  const ats = detectAtsUrl(result.url);
  if (!ats) return result;

  const fetchFn = options.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") return result;

  const apiUrl = ats.ats === "ashby"
    ? `https://api.ashbyhq.com/posting-api/job-board/${ats.slug}?includeCompensation=true`
    : `https://boards-api.greenhouse.io/v1/boards/${ats.slug}/jobs`;

  let data;
  try {
    const res = await fetchFn(apiUrl);
    if (!res || !res.ok) return result;
    data = await res.json();
  } catch {
    return result;
  }

  const jobs = (data && Array.isArray(data.jobs)) ? data.jobs : [];
  // Greenhouse job IDs are numeric in the API but string-y in URLs; compare as strings.
  const job = jobs.find((j) => String(j && j.id) === String(ats.jobId));
  if (!job) return result;

  const upgrade = ats.ats === "ashby"
    ? upgradeFromAshbyJob(job, ats.slug)
    : upgradeFromGreenhouseJob(job, ats.slug);

  return {
    ...result,
    ...upgrade,
    location_upgraded_from: "ats_api",
  };
}
