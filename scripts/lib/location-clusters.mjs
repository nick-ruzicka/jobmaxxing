// Metro-area clustering for job locations.
//
// SINGLE SOURCE OF TRUTH — imported by scripts/scan-jobs.mjs (scan-time classification),
// scripts/lib/location.mjs (scrape-text resolver), scripts/backfill-locations.mjs, and the
// dashboard via dashboard-web/lib/location-clusters.ts (a thin re-export; the dashboard's
// tsconfig has allowJs + resolveJsonModule so it can import this .mjs directly). Zero deps,
// no side effects.

/**
 * @typedef {"remote"|"hybrid"|"onsite"|"unknown"} Workplace
 * @typedef {{ workplace: Workplace, city: string|null, region: string|null }} StructuredLocation
 */

export const METRO_CLUSTERS = {
  nyc: {
    label: "NYC area",
    cities: [
      "new york", "new york city", "nyc", "manhattan", "brooklyn", "queens",
      "the bronx", "bronx", "staten island", "long island city", "lic",
      "soho", "midtown", "midtown manhattan", "flatiron", "tribeca", "chelsea",
      "williamsburg", "harlem", "financial district",
      "jersey city", "hoboken", "newark", "weehawken",
      "yonkers", "white plains", "stamford", "princeton",
    ],
  },
  sf_bay: {
    label: "SF Bay",
    cities: [
      "san francisco", "sf", "south san francisco", "ssf", "daly city",
      "oakland", "berkeley", "emeryville", "alameda", "richmond",
      "san jose", "santa clara", "sunnyvale", "mountain view", "palo alto",
      "menlo park", "redwood city", "san mateo", "foster city", "burlingame",
      "cupertino", "los altos", "milpitas", "fremont", "san carlos",
      "bay area", "san francisco bay area", "sf bay area", "silicon valley",
    ],
  },
  la: {
    label: "LA area",
    cities: [
      "los angeles", "la", "l a", "santa monica", "venice", "marina del rey",
      "playa vista", "playa del rey", "el segundo", "culver city", "beverly hills",
      "west hollywood", "hollywood", "pasadena", "burbank", "glendale",
      "long beach", "manhattan beach", "hawthorne", "torrance", "westwood",
      "downtown la", "dtla",
    ],
  },
  boston: {
    label: "Boston area",
    cities: ["boston", "cambridge", "somerville", "brookline", "waltham", "watertown", "newton", "medford"],
  },
  seattle: {
    label: "Seattle area",
    cities: ["seattle", "bellevue", "redmond", "kirkland", "renton"],
  },
  austin: { label: "Austin", cities: ["austin"] },
  denver: { label: "Denver area", cities: ["denver", "boulder", "broomfield"] },
  chicago: { label: "Chicago", cities: ["chicago", "evanston"] },
};

export const US_STATE_CODES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky",
  "la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd",
  "oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc",
]);

export const INTL_COUNTRY_HINTS = [
  "united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "ireland",
  "canada", "germany", "france", "spain", "portugal", "netherlands", "the netherlands",
  "belgium", "switzerland", "sweden", "norway", "denmark", "finland", "poland", "austria",
  "italy", "greece", "czech republic", "czechia", "romania", "hungary",
  "india", "singapore", "australia", "new zealand", "brazil", "brasil", "mexico", "méxico",
  "argentina", "colombia", "chile", "peru", "south africa", "nigeria", "kenya", "egypt",
  "israel", "united arab emirates", "uae", "saudi arabia", "turkey", "türkiye",
  "japan", "china", "hong kong", "taiwan", "south korea", "philippines", "indonesia",
  "vietnam", "thailand", "malaysia",
];

export const KNOWN_INTL_CITIES = [
  "london", "manchester", "birmingham", "edinburgh", "glasgow", "bristol", "leeds",
  "dublin", "cork", "galway", "berlin", "munich", "münchen", "hamburg", "cologne", "köln",
  "frankfurt", "paris", "lyon", "marseille", "madrid", "barcelona", "valencia", "lisbon",
  "lisboa", "porto", "amsterdam", "rotterdam", "the hague", "utrecht", "brussels", "antwerp",
  "zurich", "zürich", "geneva", "basel", "bern", "stockholm", "gothenburg", "oslo",
  "copenhagen", "helsinki", "warsaw", "kraków", "krakow", "wrocław", "vienna", "wien",
  "milan", "milano", "rome", "roma", "turin", "athens", "prague", "bucharest", "budapest",
  "bengaluru", "bangalore", "mumbai", "bombay", "delhi", "new delhi", "hyderabad", "chennai",
  "pune", "kolkata", "gurgaon", "gurugram", "noida", "ahmedabad",
  "singapore", "sydney", "melbourne", "brisbane", "perth", "auckland", "wellington",
  "são paulo", "sao paulo", "rio de janeiro", "belo horizonte", "brasília", "brasilia",
  "mexico city", "ciudad de méxico", "cdmx", "guadalajara", "monterrey",
  "buenos aires", "córdoba", "bogotá", "bogota", "medellín", "medellin", "santiago", "lima",
  "cape town", "johannesburg", "pretoria", "nairobi", "lagos", "cairo",
  "tel aviv", "jerusalem", "haifa", "dubai", "abu dhabi", "riyadh", "istanbul", "ankara",
  "tokyo", "osaka", "kyoto", "yokohama", "beijing", "shanghai", "shenzhen", "guangzhou",
  "hong kong", "taipei", "seoul", "busan", "manila", "cebu", "jakarta", "bandung",
  "ho chi minh city", "hanoi", "bangkok", "kuala lumpur",
  "toronto", "vancouver", "montreal", "montréal", "ottawa", "calgary", "edmonton",
  "waterloo", "kitchener", "mississauga", "winnipeg", "halifax", "québec", "quebec city",
];

function norm(s) {
  return (s == null ? "" : String(s))
    .toLowerCase()
    .replace(/[.,/|()]/g, " ")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function titleCase(s) {
  return norm(s).split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function clusterForCity(city) {
  const c = norm(city);
  if (!c) return null;
  for (const [key, def] of Object.entries(METRO_CLUSTERS)) {
    if (def.cities.includes(c)) return key;
  }
  for (const [key, def] of Object.entries(METRO_CLUSTERS)) {
    for (const name of def.cities) {
      if (name.length <= 3) continue;
      if (new RegExp(`\\b${reEscape(name)}\\b`).test(c)) return key;
    }
  }
  return null;
}

export function looksUS(city, region) {
  const r = norm(region);
  if (r) {
    if (US_STATE_CODES.has(r)) return true;
    if (r === "usa" || r === "us" || r === "united states" || r === "united states of america" || r === "u s a" || r === "u s") return true;
    if (INTL_COUNTRY_HINTS.includes(r)) return false;
  }
  const c = norm(city);
  if (c && KNOWN_INTL_CITIES.includes(c)) return false;
  if (clusterForCity(c)) return true;
  return false;
}

export function clusterForLocation(loc) {
  const workplace = loc?.workplace || "unknown";
  const city = loc?.city || null;
  const region = loc?.region || null;
  if (workplace === "remote") {
    return clusterForCity(city) === "nyc" ? "nyc" : "remote";
  }
  const metro = clusterForCity(city);
  if (metro) return metro;
  if (!city) return "unknown";
  return looksUS(city, region) ? "other_us" : "other_intl";
}

export function flattenLocation(loc) {
  const workplace = loc?.workplace || "unknown";
  const city = loc?.city || null;
  const region = loc?.region || null;
  const metroKey = clusterForCity(city);
  let place = null;
  if (metroKey) {
    place = METRO_CLUSTERS[metroKey].label;
  } else if (city) {
    const r = norm(region);
    if (r && US_STATE_CODES.has(r)) place = `${titleCase(city)}, ${r.toUpperCase()}`;
    else if (r) place = `${titleCase(city)}, ${titleCase(region)}`;
    else place = titleCase(city);
  }
  if (workplace === "remote") {
    if (place && metroKey) return `Remote · ${place}`;
    if (place) return `Remote (${place})`;
    return "Remote US";
  }
  if (workplace === "hybrid") return place ? `Hybrid · ${place}` : "Hybrid (location unclear)";
  if (workplace === "onsite") return place || "On-site";
  return place || "Unknown";
}

// Short/abbreviated metro aliases → their canonical city name.
// Only covers abbreviations and cluster-label phrases, NOT real city names
// (e.g. "menlo park" or "brooklyn" stay as-is).
const CITY_CANON_ALIASES = new Map([
  ["nyc", "new york"],
  ["new york city", "new york"],
  ["sf", "san francisco"],
  ["sf bay area", "san francisco"],
  ["san francisco bay area", "san francisco"],
  ["bay area", "san francisco"],
  ["silicon valley", "san francisco"],
  ["la", "los angeles"],
  ["l a", "los angeles"],
  ["dtla", "los angeles"],
  ["downtown la", "los angeles"],
  // cluster label phrases used in flattenLocation output
  ["nyc area", "new york"],
  ["sf bay", "san francisco"],
  ["la area", "los angeles"],
  ["boston area", "boston"],
  ["seattle area", "seattle"],
  ["denver area", "denver"],
]);

function canonicalCity(alias) {
  const n = norm(alias);
  return CITY_CANON_ALIASES.get(n) || n;
}

export function parseLocationString(str) {
  const raw = str == null ? "" : String(str).trim();
  if (!raw || /^(unknown|not specified|not listed|n\/?a|—|-)$/i.test(raw)) {
    return { workplace: "unknown", city: null, region: null };
  }
  // Normalize: keep · as a separator (convert to space), also convert dashes/em-dashes
  const lc = norm(raw).replace(/·/g, " ").replace(/\s+/g, " ").trim();

  let workplace = "unknown";
  if (/\b(remote|anywhere|distributed|work from home|wfh)\b/.test(lc)) workplace = "remote";
  else if (/\bhybrid\b/.test(lc)) workplace = "hybrid";
  else if (/\b(on-?site|onsite|in-?office|in office)\b/.test(lc)) workplace = "onsite";

  // Strip workplace keywords and separators to get a location blob
  const blob = lc
    .replace(/\b(remote|hybrid|on-?site|onsite|in-?office|in office|anywhere|distributed|work from home|wfh|us|usa|united states|north america|emea|apac|amer)\b/g, " ")
    .replace(/\s+/g, " ").trim();

  // Check CITY_CANON_ALIASES first on the full blob (handles "la area", "nyc area", "sf bay", etc.)
  let city = null;
  if (CITY_CANON_ALIASES.has(blob)) {
    city = CITY_CANON_ALIASES.get(blob);
  }

  // Region detection — only after we've checked for cluster-label aliases
  // to avoid treating "LA" (= Los Angeles) as Louisiana state code
  let region = null;
  if (!city) {
    const stateCodes = (blob.match(/\b[a-z]{2}\b/g) || []).filter((s) => US_STATE_CODES.has(s));
    if (stateCodes.length) region = stateCodes[stateCodes.length - 1];
    if (!region) {
      for (const hint of INTL_COUNTRY_HINTS) {
        if (new RegExp(`\\b${reEscape(hint)}\\b`).test(lc)) { region = hint; break; }
      }
    }
  }

  if (!city) {
    // Strip state codes from blob for city-name matching
    const blobNoState = blob
      .replace(/\b[a-z]{2}\b/g, (m) => (US_STATE_CODES.has(m) ? " " : m))
      .replace(/\s+/g, " ").trim();
    for (const def of Object.values(METRO_CLUSTERS)) {
      for (const name of def.cities) {
        if (name.length <= 3) continue;
        if (new RegExp(`\\b${reEscape(name)}\\b`).test(blobNoState)) { city = name; break; }
      }
      if (city) break;
    }
    if (!city) {
      for (const name of KNOWN_INTL_CITIES) {
        if (new RegExp(`\\b${reEscape(name)}\\b`).test(blobNoState)) { city = name; break; }
      }
    }
    if (!city && blobNoState && blobNoState.split(" ").length <= 4 && /^[a-zà-ÿ' ]+$/.test(blobNoState)) {
      city = canonicalCity(blobNoState);
    }
  }

  if (workplace === "unknown" && city) workplace = "onsite";
  return { workplace, city, region };
}

export const CLUSTER_ORDER = ["nyc", "remote", "sf_bay", "la", "boston", "seattle", "austin", "denver", "chicago", "other_us", "other_intl", "unknown"];

export const CLUSTER_META = {
  nyc:        { label: "NYC area",     tone: "in-scope" },
  remote:     { label: "Remote",       tone: "in-scope" },
  sf_bay:     { label: "SF Bay",       tone: "out-of-scope" },
  la:         { label: "LA area",      tone: "out-of-scope" },
  boston:     { label: "Boston area",  tone: "out-of-scope" },
  seattle:    { label: "Seattle area", tone: "out-of-scope" },
  austin:     { label: "Austin",       tone: "out-of-scope" },
  denver:     { label: "Denver area",  tone: "out-of-scope" },
  chicago:    { label: "Chicago",      tone: "out-of-scope" },
  other_us:   { label: "Other US",     tone: "out-of-scope" },
  other_intl: { label: "Other Intl",   tone: "out-of-scope" },
  unknown:    { label: "Unknown",      tone: "unknown" },
};
