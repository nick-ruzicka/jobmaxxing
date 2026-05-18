// builtin-jsonld-upgrade.mjs — for builtin.com/job/... URLs whose seen-urls entry
// landed with workplace inferred but city missing (BuiltIn search-page CARDS expose
// only a workplace icon + a "5 Locations" string, not the rich location array).
// Each BuiltIn JOB PAGE embeds a full JSON-LD JobPosting with structured
// jobLocation (often an array — multi-office roles), baseSalary, etc.
//
// This is the BuiltIn analogue of ats-url-upgrade.mjs (Ashby/Greenhouse).
//
// Multi-location handling: when JSON-LD's jobLocation is an array, pickBestLocation
// chooses the best for the user (preferred cities > neutral > avoided > international).
// A multi-location role also defaults to workplace="hybrid" (the convention: if a
// big-company role lists 2+ offices, it's hybrid by definition — pick your city).
// A single-location role preserves the existing workplace value (typically onsite).

import { structuredLocationFields } from "./location.mjs";

const BUILTIN_URL_RE = /^https?:\/\/builtin\.com\/job\//i;

/** True if URL looks like a builtin.com job page. */
export function detectBuiltinUrl(url) {
  if (!url || typeof url !== "string") return false;
  return BUILTIN_URL_RE.test(url);
}

/**
 * Extract every JSON-LD blob from a page. Returns array of parsed objects.
 * Handles both flat (JobPosting at top level) and @graph-wrapped (one of many
 * objects in a @graph array) shapes — both are valid schema.org.
 */
function extractJsonLdBlocks(html) {
  const out = [];
  // Note: real-world HTML often encodes `+` in attribute values. BuiltIn ships
  // `application/ld&#x2B;json` (hex entity). Accept literal `+`, `&#x2B;`, or
  // `&#43;` — all decode to the same character in the browser.
  const re = /<script[^>]*\btype=["']application\/ld(?:\+|&#x2[bB];|&#43;)json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks = String(html).matchAll(re);
  for (const m of blocks) {
    try {
      const parsed = JSON.parse(m[1].trim());
      out.push(parsed);
    } catch {
      // Skip malformed blobs silently — common when sites embed comments
    }
  }
  return out;
}

/** Find the JobPosting object inside a blob — handles {@graph: [...]} and flat shapes. */
function findJobPosting(blob) {
  if (!blob || typeof blob !== "object") return null;
  if (blob["@type"] === "JobPosting") return blob;
  const graph = blob["@graph"];
  if (Array.isArray(graph)) {
    for (const item of graph) {
      if (item && item["@type"] === "JobPosting") return item;
    }
  }
  return null;
}

function normCity(s) {
  return s == null ? null : String(s).toLowerCase().trim() || null;
}

function placeToLocation(place) {
  const addr = place && place.address;
  if (!addr) return null;
  return {
    city: normCity(addr.addressLocality),
    region: normCity(addr.addressRegion),
    country: addr.addressCountry || null,
  };
}

/**
 * Parse a BuiltIn JOB-page's HTML into the fields we care about.
 * Returns {title, company, employmentType, baseSalary: {min, max}|null, jobLocations: [...]}
 * or null if no JobPosting found.
 */
export function parseBuiltinJsonLd(html) {
  const blocks = extractJsonLdBlocks(html);
  let posting = null;
  for (const blob of blocks) {
    posting = findJobPosting(blob);
    if (posting) break;
  }
  if (!posting) return null;

  const jl = posting.jobLocation;
  const jobLocations = [];
  if (Array.isArray(jl)) {
    for (const p of jl) {
      const loc = placeToLocation(p);
      if (loc) jobLocations.push(loc);
    }
  } else if (jl) {
    const loc = placeToLocation(jl);
    if (loc) jobLocations.push(loc);
  }

  let baseSalary = null;
  const bs = posting.baseSalary;
  if (bs && bs.value && (bs.value.minValue || bs.value.maxValue)) {
    baseSalary = { min: bs.value.minValue ?? null, max: bs.value.maxValue ?? null };
  }

  return {
    title: posting.title || "",
    company: (posting.hiringOrganization && posting.hiringOrganization.name) || "",
    employmentType: posting.employmentType || null,
    baseSalary,
    jobLocations,
  };
}

/**
 * Pick the best location for the user from a list, using a simple preference
 * vector. Returns the single chosen location or null on empty input.
 *
 * @param {Array} locations
 * @param {{preferred: string[], avoid: string[]}} preferences
 */
export function pickBestLocation(locations, preferences = { preferred: [], avoid: [] }) {
  if (!Array.isArray(locations) || locations.length === 0) return null;
  if (locations.length === 1) return locations[0];

  const preferred = new Set((preferences.preferred || []).map((c) => c.toLowerCase()));
  const avoid = new Set((preferences.avoid || []).map((c) => c.toLowerCase()));

  function scoreLocation(loc) {
    const city = (loc.city || "").toLowerCase();
    if (preferred.has(city)) return 100;
    const country = (loc.country || "").toLowerCase();
    const isUs = country === "usa" || country === "us" || country === "united states";
    if (avoid.has(city)) return isUs ? -10 : -50;
    if (isUs) return 40;
    return -50;
  }

  let best = locations[0];
  let bestScore = scoreLocation(best);
  for (let i = 1; i < locations.length; i++) {
    const s = scoreLocation(locations[i]);
    if (s > bestScore) {
      best = locations[i];
      bestScore = s;
    }
  }
  return best;
}

/**
 * Format the BuiltIn baseSalary into the short comp string the rest of the
 * pipeline expects ($191K-$249K).
 */
function formatComp({ min, max }) {
  if (!min && !max) return "";
  const m = (v) => `$${Math.round(v / 1000)}K`;
  if (min && max) return `${m(min)}-${m(max)}`;
  if (min) return `${m(min)}+`;
  return `Up to ${m(max)}`;
}

/**
 * Orchestrator. If `result.url` is a builtin.com job page AND `location_city`
 * is missing (the actual gap — `location_workplace` may have been set by the
 * card scrape), fetch the page, parse JSON-LD, pick the best location for the
 * user, and replace location/comp fields. Marks `location_upgraded_from:
 * "builtin_jsonld"` and preserves `all_locations` for audit.
 *
 * Multi-location roles default workplace="hybrid" (multi-office convention).
 * Single-location roles preserve the existing workplace value.
 *
 * @param {object} result
 * @param {object} [options]
 * @param {Function} [options.fetch]                     - injectable fetcher
 * @param {{preferred: string[], avoid: string[]}} [options.preferences]
 */
export async function upgradeBuiltinResult(result, options = {}) {
  if (!result || typeof result !== "object") return result;
  if (!detectBuiltinUrl(result.url)) return result;

  // Upgrade trigger: missing city is the real bug signal. Workplace may be set
  // (from card icon) but city missing means location is effectively unknown.
  const cityMissing = !result.location_city;
  const workplaceUnknown = !result.location_workplace || result.location_workplace === "unknown";
  if (!cityMissing && !workplaceUnknown) return result;

  const fetchFn = options.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") return result;

  let html;
  try {
    const res = await fetchFn(result.url);
    if (!res || !res.ok) return result;
    html = await res.text();
  } catch {
    return result;
  }

  const parsed = parseBuiltinJsonLd(html);
  if (!parsed || parsed.jobLocations.length === 0) return result;

  const best = pickBestLocation(parsed.jobLocations, options.preferences);
  if (!best) return result;

  // Multi-office convention: 2+ jobLocations → assume hybrid (you pick your office).
  // Single-office → preserve existing workplace, falling back to "onsite" if unknown.
  let workplace;
  if (parsed.jobLocations.length >= 2) {
    workplace = "hybrid";
  } else if (result.location_workplace && result.location_workplace !== "unknown") {
    workplace = result.location_workplace;
  } else {
    workplace = "onsite";
  }

  const compFields = parsed.baseSalary ? { comp: formatComp(parsed.baseSalary) } : {};
  // structuredLocationFields normalizes the picked city via existing infra
  // (handles NYC alias, US-state detection, etc).
  const locFields = structuredLocationFields(
    best.city || "",
    workplace === "remote",
    workplace === "hybrid" ? "Hybrid" : workplace === "onsite" ? "OnSite" : null,
  );

  return {
    ...result,
    title: parsed.title || result.title,
    company: parsed.company || result.company,
    ...locFields,
    ...compFields,
    all_locations: parsed.jobLocations,
    location_upgraded_from: "builtin_jsonld",
  };
}
