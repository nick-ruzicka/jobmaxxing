// Scrape-text location extraction for scan-jobs.mjs. Turns scraped JD text / BuiltIn card
// strings / Exa highlights / Ashby+Greenhouse API fields into a {workplace, city, region}
// triple. Builds on the metro definitions in ./location-clusters.mjs.
//
// Design: the JD BODY is authoritative. URL slugs from re-syndicators
// ("...-new-york-ny-united-states") are auto-generated and lie, so the slug is only consulted
// when the body says nothing about location, and then only to recover a concrete CITY —
// never a workplace type, and never when the slug carries the "-united-states" re-syndication
// template. Workplace resolution order is hybrid > onsite > remote: a passing mention of
// "remote-friendly culture" must not override an explicit on-site or hybrid statement.

import {
  METRO_CLUSTERS,
  US_STATE_CODES,
  INTL_COUNTRY_HINTS,
  KNOWN_INTL_CITIES,
  clusterForCity,
  flattenLocation,
  parseLocationString,
} from "./location-clusters.mjs";

function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const CITY_ALIASES = (() => {
  const out = [];
  for (const [key, def] of Object.entries(METRO_CLUSTERS)) {
    for (const name of def.cities) if (name.length >= 4) out.push({ name, key });
  }
  for (const name of KNOWN_INTL_CITIES) if (name.length >= 4) out.push({ name, key: null });
  out.sort((a, b) => b.name.length - a.name.length);
  return out;
})();

const STATE_NAME_TO_CODE = {
  "new york": "ny", california: "ca", massachusetts: "ma", washington: "wa", texas: "tx",
  colorado: "co", illinois: "il", georgia: "ga", florida: "fl", "new jersey": "nj",
  pennsylvania: "pa", virginia: "va", "north carolina": "nc", arizona: "az", oregon: "or",
  utah: "ut", tennessee: "tn", "district of columbia": "dc",
};

function normText(s) {
  return (s == null ? "" : String(s)).toLowerCase().replace(/\s+/g, " ").trim();
}

function findCity(text) {
  const t = normText(text);
  if (!t) return null;
  for (const { name, key } of CITY_ALIASES) {
    const m = t.match(new RegExp(`\\b${reEscape(name)}\\b([^.]{0,40})`));
    if (!m) continue;
    let region = null;
    const tail = m[1] || "";
    const codeM = tail.match(/[, ]+([a-z]{2})\b/);
    if (codeM && US_STATE_CODES.has(codeM[1])) region = codeM[1];
    if (!region) {
      for (const [nm, code] of Object.entries(STATE_NAME_TO_CODE)) {
        if (new RegExp(`\\b${reEscape(nm)}\\b`).test(tail)) { region = code; break; }
      }
    }
    if (!region && key === null) {
      for (const hint of INTL_COUNTRY_HINTS) {
        if (new RegExp(`\\b${reEscape(hint)}\\b`).test(tail) || new RegExp(`\\b${reEscape(hint)}\\b`).test(t)) { region = hint; break; }
      }
    }
    return { city: name, region, key };
  }
  return null;
}

// Detect workplace type from text. Returns "hybrid" | "onsite" | "remote" | null.
// Hybrid > onsite > remote: explicit hybrid/onsite signals override a passing remote mention.
// A mere "remote-friendly culture" aside does NOT make a role remote.
function workplaceFromText(text) {
  const t = normText(text);
  if (!t) return null;

  // Hybrid: explicit hybrid keyword OR "N days a week in [office]" phrasing
  const hybrid =
    /\bhybrid\b/.test(t) ||
    /\b\d+\s*days?\s*(a|per)\s*week\s+in\b/.test(t);
  if (hybrid) return "hybrid";

  // Onsite: explicit in-office/onsite signals OR "in our [city] office" phrasing
  const onsite =
    /\b(on-?site|onsite|in-?office|in the office)\b/.test(t) ||
    /\bin\s+(our|the)\s+[a-z .]{0,30}\boffice\b/.test(t);
  if (onsite) return "onsite";

  // Remote: strong remote-first signals (fully remote, 100% remote, etc.)
  // A generic "remote-friendly" or "remote-friendly culture" aside is NOT enough
  if (
    /\b(fully remote|remote-first|100% remote|work from anywhere|distributed team|fully distributed)\b/.test(t)
  ) return "remote";

  // Plain "remote" only if not qualified with "non-remote" or part of a "remote-friendly" phrase
  if (/\bremote\b/.test(t) && !/\bnon-?remote\b/.test(t) && !/\bremote-friendly\b/.test(t)) {
    return "remote";
  }

  return null;
}

export function resolveTextLocation(title, url, text) {
  const body = `${title || ""} ${text || ""}`;
  const urlBlob = (url || "").toLowerCase();
  const wp = workplaceFromText(body);
  const found = findCity(body);
  if (wp || found) {
    return {
      workplace: wp || (found ? "onsite" : "unknown"),
      city: found ? found.city : null,
      region: found ? found.region : null,
    };
  }
  if (!urlBlob.includes("-united-states")) {
    const slug = urlBlob.replace(/[^a-z]+/g, " ");
    const fromSlug = findCity(slug);
    if (fromSlug) return { workplace: "onsite", city: fromSlug.city, region: fromSlug.region };
  }
  return { workplace: "unknown", city: null, region: null };
}

export function resolveStructuredLocation(locationStr, isRemote, workplaceType) {
  const parsed = parseLocationString(locationStr);
  let workplace = "unknown";
  const wt = (workplaceType || "").toLowerCase();
  if (wt === "remote") workplace = "remote";
  else if (wt === "hybrid") workplace = "hybrid";
  else if (wt === "onsite" || wt === "on-site") workplace = "onsite";
  else if (isRemote) workplace = "remote";
  else if (parsed.workplace !== "unknown") workplace = parsed.workplace;
  else if (parsed.city) workplace = "onsite";
  if (!workplaceType && isRemote && clusterForCity(parsed.city) === "nyc") workplace = "hybrid";
  return { workplace, city: parsed.city, region: parsed.region };
}

export function locationFields(title, url, text) {
  const loc = resolveTextLocation(title, url, text);
  return {
    location: flattenLocation(loc),
    location_workplace: loc.workplace,
    location_city: loc.city,
    location_region: loc.region,
  };
}

export function structuredLocationFields(locationStr, isRemote, workplaceType) {
  const loc = resolveStructuredLocation(locationStr, isRemote, workplaceType);
  return {
    location: flattenLocation(loc),
    location_workplace: loc.workplace,
    location_city: loc.city,
    location_region: loc.region,
  };
}
