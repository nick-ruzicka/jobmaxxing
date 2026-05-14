# Hybrid Location Classification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `location` string ("NYC" / "Remote" / "Hybrid" / "San Francisco" / "Unknown") with a structured `{workplace, city, region}` model + metro-area clustering, so a hybrid role in Marina del Rey is no longer indistinguishable from a hybrid role in Manhattan — and so one dashboard filter chip ("NYC area") answers the user's real question: *"is this within my geographic constraint?"*

**Architecture:** A single source-of-truth ESM module `scripts/lib/location-clusters.mjs` holds the metro definitions + `clusterForLocation()` / `flattenLocation()` / `parseLocationString()` — imported by both `scripts/scan-jobs.mjs` (scan-time) and `dashboard-web/lib/*` (`allowJs`+`resolveJsonModule` are already on in `dashboard-web/tsconfig.json`). The heavier scrape-text extraction logic lives in `scripts/lib/location.mjs` (scan-side only). `scan-jobs.mjs` writes `location` + `location_workplace` + `location_city` + `location_region` to each `data/seen-urls.json` entry. The dashboard reads those structured fields, derives a `location_cluster`, and the filter UI becomes cluster-first. A one-shot `scripts/backfill-locations.mjs` upgrades the ~1228 existing entries from their cached strings + enrichment text + URL.

**Tech Stack:** Node 18+ (`node:test` built-in test runner, zero new deps), ESM (`.mjs`), Next.js 16 + TypeScript (dashboard), no build step for scripts.

**Branch:** `fix/hybrid-location-classification` (already created off `main` after `fix/builtin-scan-recall` was fast-forward-merged in). Do not push until the user says so.

---

## Review Checkpoints (the user asked to spot-check these before coding)

These four items are surfaced here so the user can sign off before implementation begins. They are also embedded in the tasks below.

### A. Metro cluster definitions

Defined in `scripts/lib/location-clusters.mjs` (Task 1). A city's cluster is decided by membership in one of these lists (case-insensitive, `.`/`,` stripped, word-boundary fallback for compound strings like `"new york ny"`):

| Cluster key | Label | Cities / aliases |
|---|---|---|
| `nyc` | **NYC area** | new york, new york city, nyc, manhattan, brooklyn, queens, bronx, the bronx, staten island, long island city, lic, soho, midtown, midtown manhattan, flatiron, tribeca, chelsea, williamsburg, harlem, financial district, jersey city, hoboken, newark, weehawken, yonkers, white plains, stamford, princeton |
| `sf_bay` | **SF Bay** | san francisco, sf, south san francisco, ssf, daly city, oakland, berkeley, emeryville, alameda, richmond, san jose, santa clara, sunnyvale, mountain view, palo alto, menlo park, redwood city, san mateo, foster city, burlingame, cupertino, los altos, milpitas, fremont, san carlos, bay area, san francisco bay area, sf bay area, silicon valley |
| `la` | **LA area** | los angeles, la, l.a., santa monica, venice, marina del rey, playa vista, playa del rey, el segundo, culver city, beverly hills, west hollywood, hollywood, pasadena, burbank, glendale, long beach, manhattan beach, hawthorne, torrance, westwood, downtown la, dtla |
| `boston` | **Boston area** | boston, cambridge, somerville, brookline, waltham, watertown, newton, medford |
| `seattle` | **Seattle area** | seattle, bellevue, redmond, kirkland, renton |
| `austin` | **Austin** | austin |
| `denver` | **Denver area** | denver, boulder, broomfield |
| `chicago` | **Chicago** | chicago, evanston |

Plus three **virtual** clusters that aren't city lists:
- `remote` — workplace is `remote` and the role isn't anchored to NYC metro (a remote role *anchored* to NYC metro reports as `nyc` so it surfaces under the NYC filter).
- `other_us` — has a city, looks US (state code present, or a `KNOWN_INTL_CITIES` miss + `looksUS` true), but not in a named metro (Atlanta, Houston, Phoenix/Tempe, Tampa, Salt Lake City, San Diego, Portland, DC, Nashville, Raleigh, Minneapolis, …).
- `other_intl` — has a city, looks non-US (`INTL_COUNTRY_HINTS` region, or `KNOWN_INTL_CITIES` hit): London, Dublin, Toronto, Ottawa, Vancouver, Bengaluru/Bangalore, Singapore, São Paulo, Mexico City, Cape Town, Tel Aviv, Berlin, Amsterdam, Sydney, …
- `unknown` — workplace unknown and no city, **or** workplace hybrid with no resolvable city (display string `"Hybrid (location unclear)"`, flagged for human review — not silently bucketed as generic Hybrid).

**Out of scope (Phase 11):** sub-clustering international metros (London area, GTA, etc.), user-configurable clusters.

### B. Data model change

`data/seen-urls.json` entries gain three keys (alongside the existing `location` string, which is kept and re-derived from them):
```jsonc
"https://…": {
  "firstSeen": "2026-05-13",
  "title": "GTM Engineer",
  "source": "BuiltIn",
  "company": "Sift",
  "location": "Hybrid · LA area",      // ← now DERIVED via flattenLocation(), not free text
  "location_workplace": "hybrid",      // ← new: "remote" | "hybrid" | "onsite" | "unknown"
  "location_city": "marina del rey",   // ← new: lowercase city, or null
  "location_region": "ca",             // ← new: 2-letter state (US) | country name (intl) | null
  "source_tier": "aggregator"          // (existing, unrelated)
}
```

`dashboard-web/lib/types.ts` — the `Role` interface gains (snake_case, consistent with the existing `source_tier`):
```ts
location: string;                 // existing — display string (flattenLocation output)
location_workplace: "remote" | "hybrid" | "onsite" | "unknown";   // new
location_city: string | null;     // new
location_region: string | null;   // new
location_cluster: string;          // new — computed at load via clusterForLocation(); one of
                                   // "nyc" | "remote" | "sf_bay" | "la" | "boston" | "seattle"
                                   // | "austin" | "denver" | "chicago" | "other_us"
                                   // | "other_intl" | "unknown"
```
`dashboard-web/lib/data.ts` reads `location_workplace/_city/_region` straight from the seen-urls entry when present; otherwise falls back to `parseLocationString()` on whatever string source it currently uses (scan report → stored string → `enrichment.location` → enrichment text → `title`+`url` classifier). Either way it ends with a `{workplace, city, region}` triple → `location` (= `flattenLocation()`), `location_cluster` (= `clusterForLocation()`).

### C. Filter UI change

`dashboard-web/components/FilterBar.tsx` — the location chip row goes **cluster-first**. Always shows `NYC area` and `Remote`; shows `SF Bay` / `LA area` / `Boston area` / `Seattle area` / `Austin` / `Denver area` / `Chicago` / `Other US` / `Other Intl` / `Unknown` only when their count > 0. Clicking a chip filters to roles whose `location_cluster` equals that key — so **one click on `NYC area`** shows onsite-NYC + hybrid-NYC + remote-anchored-to-NYC together, and **excludes** Sift Stack (`la`) and incident.io (`sf_bay`). Multi-select still works (`NYC area` + `Remote` = "anything I could take living in NYC"). `bucketLocation()` is replaced by `clusterForLocation()` (imported from the shared module); `PipelineTable.tsx` filter logic and the `location` sort key follow. `LocationTag.tsx` renders the `flattenLocation` string ("Hybrid · LA area", "Remote US", "San Francisco", "Hybrid (location unclear)") and colours by cluster tone (in-scope = green/indigo, out-of-scope = neutral, unknown = grey). `app/pipeline-client.tsx` stat-strip counts become cluster-aware: `nycCount` = roles with `location_cluster === "nyc"`, `remoteCount` = `"remote"`.

### D. Backfill strategy

`scripts/backfill-locations.mjs` (Task 12) — offline, idempotent, dry-run-by-default:
1. For every `data/seen-urls.json` entry **without** `location_workplace`: re-resolve from (a) the existing `location` string, (b) `data/enrichments.json[url].location` if present, (c) the joined enrichment text (`team_context` + `verdict` + `green_flags` + `red_flags`), (d) the URL slug, (e) the title — via `parseLocationString()` over (a)+(b) then `resolveTextLocation()` over (c)+(d)+(e), taking the most specific result. Write `location_workplace/_city/_region` + re-derive `location`.
2. Report, to stdout and to `reports/backfill-locations-YYYY-MM-DD.md`: total entries, how many were upgraded with a city anchor, how many had a generic-city string restructured (e.g. `"San Francisco"` → `{onsite, san francisco, null}` → cluster `sf_bay`), how many remain `unknown` / `"Hybrid (location unclear)"`, and a sample list of the still-unclassified ones (URL + title) so the user can eyeball them.
3. `--write` flag to actually persist (default = dry run printing a diff summary). JD-text / JSON-LD *re-fetch* for the still-ambiguous remainder is **out of scope for the backfill** (the JD body isn't cached in `enrichments.json`) — those get picked up naturally on the next `node scripts/scan-jobs.mjs` run, which now writes the structured fields.

---

## File Structure

**New:**
- `scripts/lib/location-clusters.mjs` — metro defs, `clusterForCity`, `clusterForLocation`, `looksUS`, `flattenLocation`, `parseLocationString`, `CLUSTER_META`, `CLUSTER_ORDER`. Single source of truth, zero deps, no side effects.
- `scripts/lib/location.mjs` — scrape-text extraction: `resolveTextLocation(title, url, text)`, `resolveStructuredLocation(locationStr, isRemote, workplaceType)`, `locationFields(...)` (spreadable `{location, location_workplace, location_city, location_region}`). Imports `location-clusters.mjs`.
- `scripts/lib/location-clusters.test.mjs` — `node:test` unit tests for the cluster module.
- `scripts/lib/location.test.mjs` — `node:test` unit tests for the resolver, including the three named acceptance roles.
- `scripts/backfill-locations.mjs` — the backfill (Task 12).
- `dashboard-web/lib/location-clusters.ts` — **thin re-export**: `export * from "../../scripts/lib/location-clusters.mjs";` plus a couple of TS-typed helpers if needed. (Keeps dashboard imports tidy; the actual logic stays in one place.)

**Modified:**
- `scripts/scan-jobs.mjs` — delete the inline `classifyLocation` / `classifyLocationStructured`; import from `lib/location.mjs`; ~10 call sites change `location: classifyLocation(a,b,c)` → `...locationFields(a,b,c)`; the 2 structured call sites change to `...structuredLocationFields(...)`; STEP 5 copies the four `location*` fields onto the seen-urls entry; the post-STEP-5 sort uses `r.location_cluster` if you want (optional — leave `r.location.includes("NYC")` working since `location` is still a string).
- `dashboard-web/lib/types.ts` — `Role` gains `location_workplace`, `location_city`, `location_region`, `location_cluster`.
- `dashboard-web/lib/data.ts` — populate the new fields; replace the local `classifyLocation` fallback usage with `parseLocationString` + the structured pipeline.
- `dashboard-web/components/FilterBar.tsx` — cluster-first chips; `bucketLocation` → `clusterForLocation`; export removed/renamed.
- `dashboard-web/components/PipelineTable.tsx` — filter logic + `location` sort use `location_cluster`.
- `dashboard-web/components/LocationTag.tsx` — colour by cluster tone; render `flattenLocation` string.
- `dashboard-web/app/pipeline-client.tsx` — `nycCount` / `remoteCount` from `location_cluster`.
- `package.json` (root) — add `"test": "node --test scripts/"`.
- `docs/PHASE_11_TODO.md` — append the two deferred items + the `career-ops` upstream-update note (Task 14).

---

## Phase 0 — Test scaffolding

### Task 0: Add the test runner script

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add `test` script**

In `package.json` `scripts`, add after `"doctor"`:
```json
    "test": "node --test scripts/",
```

- [ ] **Step 2: Verify it runs (no tests yet → exits 0 with "no tests found" or similar)**

Run: `npm test`
Expected: exit code 0 (or a benign "could not find any test files" — that's fine; real tests land next).

- [ ] **Step 3: Commit**
```bash
git add package.json
git commit -m "chore: add 'npm test' (node --test scripts/)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — `scripts/lib/location-clusters.mjs` (the metro module)

### Task 1: Write the cluster-module tests

**Files:**
- Create: `scripts/lib/location-clusters.test.mjs`

- [ ] **Step 1: Write the failing test file**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clusterForCity,
  clusterForLocation,
  flattenLocation,
  parseLocationString,
  looksUS,
  CLUSTER_META,
  CLUSTER_ORDER,
} from "./location-clusters.mjs";

test("clusterForCity — named metros", () => {
  assert.equal(clusterForCity("New York"), "nyc");
  assert.equal(clusterForCity("Brooklyn"), "nyc");
  assert.equal(clusterForCity("Jersey City"), "nyc");
  assert.equal(clusterForCity("Yonkers"), "nyc");
  assert.equal(clusterForCity("White Plains"), "nyc");
  assert.equal(clusterForCity("Stamford"), "nyc");
  assert.equal(clusterForCity("Princeton"), "nyc");
  assert.equal(clusterForCity("San Francisco"), "sf_bay");
  assert.equal(clusterForCity("Menlo Park"), "sf_bay");
  assert.equal(clusterForCity("Oakland"), "sf_bay");
  assert.equal(clusterForCity("Daly City"), "sf_bay");
  assert.equal(clusterForCity("Marina del Rey"), "la");
  assert.equal(clusterForCity("Santa Monica"), "la");
  assert.equal(clusterForCity("Cambridge"), "boston");
  assert.equal(clusterForCity("Bellevue"), "seattle");
  assert.equal(clusterForCity("Austin"), "austin");
  assert.equal(clusterForCity("Boulder"), "denver");
  assert.equal(clusterForCity("Chicago"), "chicago");
});

test("clusterForCity — compound strings via word-boundary fallback", () => {
  assert.equal(clusterForCity("New York, NY"), "nyc");
  assert.equal(clusterForCity("new york ny usa"), "nyc");
  assert.equal(clusterForCity("Los Angeles CA"), "la");
  assert.equal(clusterForCity("San Francisco, California"), "sf_bay");
});

test("clusterForCity — non-metro and unknown", () => {
  assert.equal(clusterForCity("Atlanta"), null);
  assert.equal(clusterForCity("London"), null);
  assert.equal(clusterForCity(""), null);
  assert.equal(clusterForCity(null), null);
  assert.equal(clusterForCity("Definitely Not A Place"), null);
});

test("looksUS", () => {
  assert.equal(looksUS("Atlanta", "GA"), true);
  assert.equal(looksUS("San Francisco", null), true);    // named metro ⇒ US
  assert.equal(looksUS("London", "United Kingdom"), false);
  assert.equal(looksUS("London", null), false);          // KNOWN_INTL_CITIES
  assert.equal(looksUS("Toronto", null), false);
  assert.equal(looksUS("Mystery Town", null), false);    // not confidently US
});

test("clusterForLocation — hybrid carries its city anchor", () => {
  assert.equal(clusterForLocation({ workplace: "hybrid", city: "marina del rey", region: "ca" }), "la");
  assert.equal(clusterForLocation({ workplace: "hybrid", city: "san francisco", region: "ca" }), "sf_bay");
  assert.equal(clusterForLocation({ workplace: "hybrid", city: "new york", region: "ny" }), "nyc");
  assert.equal(clusterForLocation({ workplace: "hybrid", city: null, region: null }), "unknown");
});

test("clusterForLocation — onsite", () => {
  assert.equal(clusterForLocation({ workplace: "onsite", city: "manhattan", region: "ny" }), "nyc");
  assert.equal(clusterForLocation({ workplace: "onsite", city: "atlanta", region: "ga" }), "other_us");
  assert.equal(clusterForLocation({ workplace: "onsite", city: "london", region: "united kingdom" }), "other_intl");
  assert.equal(clusterForLocation({ workplace: "onsite", city: null, region: null }), "unknown");
});

test("clusterForLocation — remote", () => {
  assert.equal(clusterForLocation({ workplace: "remote", city: null, region: null }), "remote");
  assert.equal(clusterForLocation({ workplace: "remote", city: "san francisco", region: "ca" }), "remote"); // remote ⇒ remote, not sf_bay
  assert.equal(clusterForLocation({ workplace: "remote", city: "new york", region: "ny" }), "nyc");          // …except NYC-anchored remote surfaces under NYC
});

test("flattenLocation — display strings", () => {
  assert.equal(flattenLocation({ workplace: "hybrid", city: "marina del rey", region: "ca" }), "Hybrid · LA area");
  assert.equal(flattenLocation({ workplace: "hybrid", city: "new york", region: "ny" }), "Hybrid · NYC area");
  assert.equal(flattenLocation({ workplace: "hybrid", city: null, region: null }), "Hybrid (location unclear)");
  assert.equal(flattenLocation({ workplace: "remote", city: null, region: null }), "Remote US");
  assert.equal(flattenLocation({ workplace: "remote", city: "new york", region: "ny" }), "Remote · NYC area");
  assert.equal(flattenLocation({ workplace: "onsite", city: "san francisco", region: "ca" }), "SF Bay");
  assert.equal(flattenLocation({ workplace: "onsite", city: "atlanta", region: "ga" }), "Atlanta, GA");
  assert.equal(flattenLocation({ workplace: "onsite", city: "london", region: "united kingdom" }), "London, United Kingdom");
  assert.equal(flattenLocation({ workplace: "unknown", city: null, region: null }), "Unknown");
});

test("parseLocationString — legacy & enrichment strings", () => {
  assert.deepEqual(parseLocationString("Hybrid NYC"), { workplace: "hybrid", city: "new york", region: null });
  assert.deepEqual(parseLocationString("Hybrid"), { workplace: "hybrid", city: null, region: null });
  assert.deepEqual(parseLocationString("Remote US"), { workplace: "remote", city: null, region: null });
  assert.deepEqual(parseLocationString("Remote NYC"), { workplace: "remote", city: "new york", region: null });
  assert.deepEqual(parseLocationString("San Francisco"), { workplace: "onsite", city: "san francisco", region: null });
  assert.deepEqual(parseLocationString("On-site Menlo Park"), { workplace: "onsite", city: "menlo park", region: null });
  assert.deepEqual(parseLocationString("New York, NY"), { workplace: "onsite", city: "new york", region: "ny" });
  assert.deepEqual(parseLocationString("Atlanta, GA"), { workplace: "onsite", city: "atlanta", region: "ga" });
  assert.deepEqual(parseLocationString("US-CA-Menlo Park"), { workplace: "onsite", city: "menlo park", region: "ca" });
  assert.deepEqual(parseLocationString("London, England, United Kingdom"), { workplace: "onsite", city: "london", region: "united kingdom" });
  assert.deepEqual(parseLocationString("Unknown"), { workplace: "unknown", city: null, region: null });
  assert.deepEqual(parseLocationString("Not specified"), { workplace: "unknown", city: null, region: null });
  assert.deepEqual(parseLocationString(""), { workplace: "unknown", city: null, region: null });
  assert.deepEqual(parseLocationString("Hybrid · LA area"), { workplace: "hybrid", city: "los angeles", region: null });
});

test("CLUSTER_ORDER / CLUSTER_META cover every cluster clusterForLocation can emit", () => {
  const emitted = ["nyc","remote","sf_bay","la","boston","seattle","austin","denver","chicago","other_us","other_intl","unknown"];
  for (const k of emitted) {
    assert.ok(CLUSTER_META[k], `CLUSTER_META missing ${k}`);
    assert.ok(CLUSTER_ORDER.includes(k), `CLUSTER_ORDER missing ${k}`);
  }
});
```

- [ ] **Step 2: Run the tests — they must fail (module doesn't exist)**

Run: `node --test scripts/lib/location-clusters.test.mjs`
Expected: FAIL — `Cannot find module './location-clusters.mjs'`.

- [ ] **Step 3: Commit the tests**
```bash
git add scripts/lib/location-clusters.test.mjs
git commit -m "test: cluster-module contract (clusterForCity/Location, flatten, parse)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2: Implement `scripts/lib/location-clusters.mjs`

**Files:**
- Create: `scripts/lib/location-clusters.mjs`

- [ ] **Step 1: Write the module**

```js
// Metro-area clustering for job locations.
//
// SINGLE SOURCE OF TRUTH — imported by scripts/scan-jobs.mjs (scan-time classification),
// scripts/lib/location.mjs (scrape-text resolver), scripts/backfill-locations.mjs, and the
// dashboard via dashboard-web/lib/location-clusters.ts (a thin re-export; the dashboard's
// tsconfig has allowJs + resolveJsonModule so it can import this .mjs directly). Zero deps,
// no side effects.
//
// A role's "cluster" answers the user's real question: "is this within my geographic
// constraint?" A hybrid role in Marina del Rey and a hybrid role in Manhattan are NOT the
// same — they cluster into "la" and "nyc". A remote role isn't bound to any city, so it
// clusters into "remote" (unless explicitly anchored to NYC metro, which we surface under
// "nyc" because that's still useful to someone based in NYC).

/**
 * @typedef {"remote"|"hybrid"|"onsite"|"unknown"} Workplace
 * @typedef {{ workplace: Workplace, city: string|null, region: string|null }} StructuredLocation
 */

// Metro clusters. Each `cities` entry is a lowercase city name or alias; matching is exact
// after normalisation, with a word-boundary fallback for compound strings ("new york ny").
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
  austin: {
    label: "Austin",
    cities: ["austin"],
  },
  denver: {
    label: "Denver area",
    cities: ["denver", "boulder", "broomfield"],
  },
  chicago: {
    label: "Chicago",
    cities: ["chicago", "evanston"],
  },
};

// US 2-letter postal codes — a `region` matching one of these ⇒ the location is US.
export const US_STATE_CODES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky",
  "la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd",
  "oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc",
]);

// Country-name hints that mark a location as outside the US.
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

// Cities we know are non-US, so "London" alone ⇒ international even with no country given.
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

// --- helpers ---

function norm(s) {
  return (s == null ? "" : String(s))
    .toLowerCase()
    .replace(/[.,/|()]/g, " ")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCase(s) {
  return norm(s).split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Map a bare-ish city name (possibly compound, e.g. "New York, NY") to a metro cluster key,
 * or null if it doesn't land in a named metro.
 * @param {string|null|undefined} city
 * @returns {string|null}
 */
export function clusterForCity(city) {
  const c = norm(city);
  if (!c) return null;
  // 1. exact alias match
  for (const [key, def] of Object.entries(METRO_CLUSTERS)) {
    if (def.cities.includes(c)) return key;
  }
  // 2. word-boundary match for compound strings; skip ≤3-char aliases (too ambiguous)
  for (const [key, def] of Object.entries(METRO_CLUSTERS)) {
    for (const name of def.cities) {
      if (name.length <= 3) continue;
      if (new RegExp(`\\b${reEscape(name)}\\b`).test(c)) return key;
    }
  }
  return null;
}

/**
 * Best-effort: does this city/region look like it's in the United States?
 * @param {string|null} city
 * @param {string|null} region 2-letter state code or country name
 * @returns {boolean}
 */
export function looksUS(city, region) {
  const r = norm(region);
  if (r) {
    if (US_STATE_CODES.has(r)) return true;
    if (r === "usa" || r === "us" || r === "united states" || r === "united states of america" || r === "u s a" || r === "u s") return true;
    if (INTL_COUNTRY_HINTS.includes(r)) return false;
  }
  const c = norm(city);
  if (c && KNOWN_INTL_CITIES.includes(c)) return false;
  if (clusterForCity(c)) return true; // every named metro is US
  return false; // not confidently US
}

/**
 * The filter cluster for a structured location.
 * @param {StructuredLocation} loc
 * @returns {string} "nyc"|"remote"|"sf_bay"|"la"|"boston"|"seattle"|"austin"|"denver"|"chicago"|"other_us"|"other_intl"|"unknown"
 */
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

/**
 * Human-readable string derived from the structured fields — replaces the old free-text
 * `location` value (kept for display, sorting, and back-compat with anything that does
 * `location.includes("NYC")`).
 * @param {StructuredLocation} loc
 * @returns {string}
 */
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

/**
 * Parse a free-text location string into structured form. Best-effort; used by the dashboard
 * for legacy seen-urls strings and enrichment-derived strings, and by the backfill.
 * @param {string|null|undefined} str
 * @returns {StructuredLocation}
 */
export function parseLocationString(str) {
  const raw = str == null ? "" : String(str).trim();
  if (!raw || /^(unknown|not specified|not listed|n\/?a|—|-)$/i.test(raw)) {
    return { workplace: "unknown", city: null, region: null };
  }
  const lc = norm(raw);
  let workplace = "unknown";
  if (/\b(remote|anywhere|distributed|work from home|wfh)\b/.test(lc)) workplace = "remote";
  else if (/\bhybrid\b/.test(lc)) workplace = "hybrid";
  else if (/\b(on-?site|onsite|in-?office|in office)\b/.test(lc)) workplace = "onsite";

  // Region: trailing/explicit US state code, "US-CA-…" prefixes, or a country hint.
  let region = null;
  const stateCodes = (lc.match(/\b[a-z]{2}\b/g) || []).filter((s) => US_STATE_CODES.has(s));
  if (stateCodes.length) region = stateCodes[stateCodes.length - 1];
  if (!region) {
    for (const hint of INTL_COUNTRY_HINTS) {
      if (new RegExp(`\\b${reEscape(hint)}\\b`).test(lc)) { region = hint; break; }
    }
  }

  // City: known metro alias first, then known international city, then a short residual blob.
  const blob = lc
    .replace(/\b(remote|hybrid|on-?site|onsite|in-?office|in office|anywhere|distributed|work from home|wfh|us|usa|united states|north america|emea|apac|amer)\b/g, " ")
    .replace(/\b[a-z]{2}\b/g, (m) => (US_STATE_CODES.has(m) ? " " : m))
    .replace(/[·•\-–—]/g, " ")
    .replace(/\s+/g, " ").trim();
  let city = null;
  for (const def of Object.values(METRO_CLUSTERS)) {
    for (const name of def.cities) {
      if (name.length <= 3) continue;
      if (new RegExp(`\\b${reEscape(name)}\\b`).test(blob)) { city = canonicalCity(name); break; }
    }
    if (city) break;
  }
  if (!city) {
    for (const name of KNOWN_INTL_CITIES) {
      if (new RegExp(`\\b${reEscape(name)}\\b`).test(blob)) { city = name; break; }
    }
  }
  if (!city && blob && blob.split(" ").length <= 4 && /^[a-zà-ÿ' ]+$/.test(blob)) {
    city = blob; // e.g. "tempe", "redwood city", "cape town"
  }
  if (workplace === "unknown" && city) workplace = "onsite"; // a bare city implies onsite
  return { workplace, city, region };
}

// Pick a canonical city name for an alias so parseLocationString round-trips cleanly,
// e.g. "Hybrid · LA area" → "los angeles", "manhattan" → "new york".
function canonicalCity(alias) {
  const key = clusterForCity(alias);
  if (!key) return alias;
  const canon = { nyc: "new york", sf_bay: "san francisco", la: "los angeles", boston: "boston", seattle: "seattle", austin: "austin", denver: "denver", chicago: "chicago" };
  // Only collapse to the canonical anchor when the alias is itself a sub-locality of it.
  return canon[key] || alias;
}

// Display order for the filter chip row and tags.
export const CLUSTER_ORDER = ["nyc", "remote", "sf_bay", "la", "boston", "seattle", "austin", "denver", "chicago", "other_us", "other_intl", "unknown"];

// `tone`: "in-scope" = inside the user's NYC-or-remote constraint (green/indigo),
//         "out-of-scope" = outside it (neutral), "unknown" = can't tell (grey).
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
```

- [ ] **Step 2: Run the cluster tests — they must pass**

Run: `node --test scripts/lib/location-clusters.test.mjs`
Expected: PASS (all tests in Task 1's file). If `parseLocationString("Hybrid · LA area")` doesn't yield `los angeles`, fix `canonicalCity` / the alias list — the test in Task 1 expects it. Iterate until green.

- [ ] **Step 3: Commit**
```bash
git add scripts/lib/location-clusters.mjs
git commit -m "feat(location): metro-cluster module (single source of truth)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — `scripts/lib/location.mjs` (the scrape-text resolver)

### Task 3: Write the resolver tests (incl. the three named acceptance roles)

**Files:**
- Create: `scripts/lib/location.test.mjs`

- [ ] **Step 1: Write the failing test file**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTextLocation,
  resolveStructuredLocation,
  locationFields,
} from "./location.mjs";
import { clusterForLocation } from "./location-clusters.mjs";

// --- resolveStructuredLocation: Ashby / Greenhouse API fields ---

test("resolveStructuredLocation — Ashby workplaceType=Hybrid + city string", () => {
  // incident.io GTM Engineer: Ashby, location "San Francisco", workplaceType "Hybrid"
  const loc = resolveStructuredLocation("San Francisco", false, "Hybrid");
  assert.deepEqual(loc, { workplace: "hybrid", city: "san francisco", region: null });
  assert.equal(clusterForLocation(loc), "sf_bay");
});

test("resolveStructuredLocation — Ashby workplaceType=OnSite NYC", () => {
  const loc = resolveStructuredLocation("New York, NY", false, "OnSite");
  assert.equal(loc.workplace, "onsite");
  assert.equal(clusterForLocation(loc), "nyc");
});

test("resolveStructuredLocation — Ashby Remote, no city", () => {
  const loc = resolveStructuredLocation("Remote - US", true, "Remote");
  assert.equal(loc.workplace, "remote");
  assert.equal(clusterForLocation(loc), "remote");
});

test("resolveStructuredLocation — Greenhouse city string only", () => {
  const loc = resolveStructuredLocation("Marina del Rey, CA", false, null);
  assert.deepEqual(loc, { workplace: "onsite", city: "marina del rey", region: "ca" });
  assert.equal(clusterForLocation(loc), "la");
});

// --- resolveTextLocation: scraped / BuiltIn-card / Exa text ---

test("resolveTextLocation — Sift Stack: BuiltIn card 'Hybrid' + 'Marina del Rey, CA, USA'", () => {
  // scanBuiltIn() passes `${title} ${workplace} ${locStr}` as title and `${workplace} ${locStr}` as text
  const loc = resolveTextLocation(
    "GTM Engineer Hybrid Marina del Rey, CA, USA",
    "https://builtin.com/job/gtm-engineer/8996992",
    "Hybrid Marina del Rey, CA, USA",
  );
  assert.equal(loc.workplace, "hybrid");
  assert.equal(loc.city, "marina del rey");
  assert.equal(loc.region, "ca");
  assert.equal(clusterForLocation(loc), "la");
});

test("resolveTextLocation — hybrid in NYC via JD body phrasing", () => {
  // August Law-style: "hybrid, 3 days/week in our New York office"
  const loc = resolveTextLocation(
    "Head of GTM Systems",
    "https://jobs.ashbyhq.com/august-law/abc",
    "We work hybrid, 3 days a week in our New York office in SoHo.",
  );
  assert.equal(loc.workplace, "hybrid");
  assert.equal(clusterForLocation(loc), "nyc");
});

test("resolveTextLocation — pure remote", () => {
  const loc = resolveTextLocation("RevOps Engineer", "https://example.com/jobs/123", "Fully remote, US-based.");
  assert.equal(loc.workplace, "remote");
  assert.equal(clusterForLocation(loc), "remote");
});

test("resolveTextLocation — hybrid with no resolvable city ⇒ flagged unclear", () => {
  const loc = resolveTextLocation("Sales Ops Lead", "https://example.com/jobs/x", "This is a hybrid role.");
  assert.equal(loc.workplace, "hybrid");
  assert.equal(loc.city, null);
  assert.equal(clusterForLocation(loc), "unknown");
});

test("resolveTextLocation — body silent, city recoverable from URL slug", () => {
  const loc = resolveTextLocation("GTM Engineer", "https://jobs.lever.co/acme/founding-gtm-engineer-san-francisco-12345", "Join our growing team.");
  assert.equal(loc.city, "san francisco");
});

test("resolveTextLocation — '-united-states' re-syndication slug is ignored", () => {
  const loc = resolveTextLocation("GTM Engineer", "https://lensa.com/gtm-engineer-new-york-ny-united-states-abc", "Great opportunity!");
  // body says nothing, slug carries the re-syndication template ⇒ do NOT trust it
  assert.equal(loc.city, null);
  assert.equal(loc.workplace, "unknown");
});

test("resolveTextLocation — onsite SF beats a generic 'remote-friendly culture' aside", () => {
  const loc = resolveTextLocation(
    "GTM Engineer",
    "https://jobs.ashbyhq.com/acme/sf",
    "This is an in-office role at our San Francisco HQ. We have a remote-friendly culture for some teams.",
  );
  assert.equal(loc.workplace, "onsite");
  assert.equal(clusterForLocation(loc), "sf_bay");
});

// --- locationFields: spreadable shape used at scan-jobs.mjs call sites ---

test("locationFields — returns {location, location_workplace, location_city, location_region}", () => {
  const f = locationFields("GTM Engineer Hybrid Marina del Rey, CA, USA", "https://builtin.com/job/x/1", "Hybrid Marina del Rey, CA, USA");
  assert.deepEqual(Object.keys(f).sort(), ["location", "location_city", "location_region", "location_workplace"]);
  assert.equal(f.location, "Hybrid · LA area");
  assert.equal(f.location_workplace, "hybrid");
  assert.equal(f.location_city, "marina del rey");
  assert.equal(f.location_region, "ca");
});
```

- [ ] **Step 2: Run — must fail (module missing)**

Run: `node --test scripts/lib/location.test.mjs`
Expected: FAIL — `Cannot find module './location.mjs'`.

- [ ] **Step 3: Commit the tests**
```bash
git add scripts/lib/location.test.mjs
git commit -m "test: scrape-text location resolver (incl. Sift Stack / incident.io / August Law)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4: Implement `scripts/lib/location.mjs`

**Files:**
- Create: `scripts/lib/location.mjs`

- [ ] **Step 1: Write the module**

```js
// Scrape-text location extraction for scan-jobs.mjs. Turns scraped JD text / BuiltIn card
// strings / Exa highlights / Ashby+Greenhouse API fields into a {workplace, city, region}
// triple. Builds on the metro definitions in ./location-clusters.mjs.
//
// Design (carried over from the old classifyLocation): the JD BODY is authoritative. URL
// slugs from re-syndicators ("...-new-york-ny-united-states") are auto-generated and lie, so
// the slug is only consulted when the body says nothing about location, and then only to
// recover a concrete CITY — never a workplace type, and never when the slug carries the
// "-united-states" re-syndication template.

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

// Every metro alias ≥4 chars, longest first, with the cluster it belongs to.
const CITY_ALIASES = (() => {
  const out = [];
  for (const [key, def] of Object.entries(METRO_CLUSTERS)) {
    for (const name of def.cities) if (name.length >= 4) out.push({ name, key });
  }
  // Also recognise the well-known international cities as bare anchors.
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

// Find the first metro/intl city alias mentioned in `text`. Returns {city, region, key} or null.
function findCity(text) {
  const t = normText(text);
  if (!t) return null;
  for (const { name, key } of CITY_ALIASES) {
    const m = t.match(new RegExp(`\\b${reEscape(name)}\\b([^.]{0,40})`));
    if (!m) continue;
    let region = null;
    const tail = m[1] || "";
    // "City, CA" / "City, CA, USA" / "City CA"
    const codeM = tail.match(/[, ]+([a-z]{2})\b/);
    if (codeM && US_STATE_CODES.has(codeM[1])) region = codeM[1];
    if (!region) {
      for (const [nm, code] of Object.entries(STATE_NAME_TO_CODE)) {
        if (new RegExp(`\\b${reEscape(nm)}\\b`).test(tail)) { region = code; break; }
      }
    }
    if (!region && key === null) {
      // an intl city — try to pick up the country from the tail or the whole text
      for (const hint of INTL_COUNTRY_HINTS) {
        if (new RegExp(`\\b${reEscape(hint)}\\b`).test(tail) || new RegExp(`\\b${reEscape(hint)}\\b`).test(t)) { region = hint; break; }
      }
    }
    return { city: name, region, key };
  }
  return null;
}

// Workplace signal from the body. Returns "remote" | "hybrid" | "onsite" | null.
// "onsite" only when the body is reasonably explicit (in-office / on-site / "X days a week
// in our … office"). A passing mention of "remote" in a "remote-friendly culture" aside
// shouldn't override an explicit on-site/hybrid statement, so we resolve in priority order
// hybrid > onsite > remote.
function workplaceFromText(text) {
  const t = normText(text);
  if (!t) return null;
  const hybrid = /\bhybrid\b/.test(t) || /\b\d+\s*days?\s*(a|per)\s*week\s+in\b/.test(t);
  if (hybrid) return "hybrid";
  const onsite = /\b(on-?site|onsite|in-?office|in the office)\b/.test(t)
    || /\bin\s+(our|the)\s+[a-z .]{0,30}\boffice\b/.test(t);
  if (onsite) return "onsite";
  if (/\b(fully remote|remote-first|100% remote|work from anywhere|distributed team|fully distributed)\b/.test(t)) return "remote";
  if (/\bremote\b/.test(t) && !/\bnon-?remote\b/.test(t)) return "remote";
  return null;
}

/**
 * Resolve a structured location from scraped text (Exa results, BuiltIn cards, domain scrapes).
 * @param {string} title
 * @param {string} url
 * @param {string} text  scraped JD body / highlights / BuiltIn card chrome
 * @returns {{workplace: "remote"|"hybrid"|"onsite"|"unknown", city: string|null, region: string|null}}
 */
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

  // Body said nothing → recover a CITY from the URL slug only (never a workplace), and not
  // when the slug carries the "-united-states" re-syndication template.
  if (!urlBlob.includes("-united-states")) {
    const slug = urlBlob.replace(/[^a-z]+/g, " ");
    const fromSlug = findCity(slug);
    if (fromSlug) return { workplace: "onsite", city: fromSlug.city, region: fromSlug.region };
  }
  return { workplace: "unknown", city: null, region: null };
}

/**
 * Resolve a structured location from an ATS's structured fields.
 * @param {string|null} locationStr  e.g. "San Francisco", "New York, NY", "Remote - US"
 * @param {boolean} isRemote  Ashby's job.isRemote
 * @param {string|null} workplaceType  Ashby's job.workplaceType: "Remote" | "Hybrid" | "OnSite"
 * @returns {{workplace: "remote"|"hybrid"|"onsite"|"unknown", city: string|null, region: string|null}}
 */
export function resolveStructuredLocation(locationStr, isRemote, workplaceType) {
  const parsed = parseLocationString(locationStr); // gets us city/region (and maybe a workplace)
  let workplace = "unknown";
  const wt = (workplaceType || "").toLowerCase();
  if (wt === "remote") workplace = "remote";
  else if (wt === "hybrid") workplace = "hybrid";
  else if (wt === "onsite" || wt === "on-site") workplace = "onsite";
  else if (isRemote) workplace = "remote";
  else if (parsed.workplace !== "unknown") workplace = parsed.workplace;
  else if (parsed.city) workplace = "onsite";

  // Ashby quirk: isRemote=true + a concrete NYC location historically meant "hybrid NYC".
  // Preserve that only when no explicit workplaceType disagrees.
  if (!workplaceType && isRemote && clusterForCity(parsed.city) === "nyc") workplace = "hybrid";

  return { workplace, city: parsed.city, region: parsed.region };
}

/**
 * Spreadable bundle for scan-jobs.mjs result objects:
 *   { location, location_workplace, location_city, location_region }
 * `location` is the human-readable flattenLocation() string (back-compat: anything doing
 * `r.location.includes("NYC")` still works).
 */
export function locationFields(title, url, text) {
  const loc = resolveTextLocation(title, url, text);
  return {
    location: flattenLocation(loc),
    location_workplace: loc.workplace,
    location_city: loc.city,
    location_region: loc.region,
  };
}

/** Same as locationFields() but from an ATS's structured fields. */
export function structuredLocationFields(locationStr, isRemote, workplaceType) {
  const loc = resolveStructuredLocation(locationStr, isRemote, workplaceType);
  return {
    location: flattenLocation(loc),
    location_workplace: loc.workplace,
    location_city: loc.city,
    location_region: loc.region,
  };
}
```

- [ ] **Step 2: Run the resolver tests — must pass**

Run: `node --test scripts/lib/location.test.mjs`
Expected: PASS. Iterate on the regexes in `workplaceFromText` / `findCity` until all green — especially the "onsite SF beats remote-friendly aside" and the "August Law hybrid-in-NYC body phrasing" cases.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS — both `location-clusters.test.mjs` and `location.test.mjs`.

- [ ] **Step 4: Commit**
```bash
git add scripts/lib/location.mjs
git commit -m "feat(location): scrape-text resolver (text/URL → {workplace,city,region})

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Wire the resolver into `scripts/scan-jobs.mjs`

### Task 5: Replace the inline classifiers with imports + structured call sites

**Files:**
- Modify: `scripts/scan-jobs.mjs`

- [ ] **Step 1: Add the import** (near the other imports at the top of the file)
```js
import { locationFields, structuredLocationFields } from "./lib/location.mjs";
```

- [ ] **Step 2: Delete the two inline functions** — remove `function classifyLocationStructured(...) { … }` (≈ lines 405–453) and `function classifyLocation(title, url, text) { … }` (≈ lines 456–498), plus the long comment block above `classifyLocation`. (Leave `classifySourceTier`, `normalizeUrl`, `extractCompany`, etc. untouched.)

- [ ] **Step 3: Update the two structured call sites**

`scanAshby` (≈ line 691):
```js
// before:  const location = classifyLocationStructured(loc, job.isRemote, job.workplaceType);
// after — drop the `location` local; spread the bundle into the pushed object instead:
```
Find the object literal that pushed the Ashby result (it has `location,` as a shorthand key) and change `location,` → `...structuredLocationFields(loc, job.isRemote, job.workplaceType),`. Remove the now-unused `const location = …` line.

`scanGreenhouse` (≈ line 744): same — replace `const location = classifyLocationStructured(loc, false, null);` and the `location,` shorthand with `...structuredLocationFields(loc, false, null),` in the pushed object.

- [ ] **Step 4: Update every text call site** — there are ~7. In each, `location: classifyLocation(<a>, <b>, <c>)` becomes `...locationFields(<a>, <b>, <c>)`:
  - `scanBuiltIn` (≈ line 1209): `location: classifyLocation(\`${title} ${workplace} ${locStr}\`, BUILTIN_BASE + href, \`${workplace} ${locStr}\`)` → `...locationFields(\`${title} ${workplace} ${locStr}\`, BUILTIN_BASE + href, \`${workplace} ${locStr}\`)`
  - `runExaQueries` (≈ line 1013): `location: classifyLocation(title, url, text + " " + highlights)` → `...locationFields(title, url, text + " " + highlights)`
  - `scanDomainSource` (≈ lines 1346, 1385): `location: classifyLocation(r.title || "", r.url || "", (r.text || "") + " " + ((r.highlights || []).join(" ")))` → `...locationFields(r.title || "", r.url || "", (r.text || "") + " " + ((r.highlights || []).join(" ")))`
  - `scanDomainSource` page-fetch branch (≈ line 1492): `location: classifyLocation(cleanedTitle, url, text)` → `...locationFields(cleanedTitle, url, text)`
  - the BuiltIn/YC resolution-pass write (≈ line 1542): `location: classifyLocation(title, url, text + " " + highlights)` → `...locationFields(title, url, text + " " + highlights)`
  - the final enrichment fallback (≈ line 1619): `r.location = classifyLocation(r.title, r.url, r.text + " " + (r.highlights || ""))` → `Object.assign(r, locationFields(r.title, r.url, r.text + " " + (r.highlights || "")))`

  > **Note:** wherever the result object already has a `location` shorthand key in addition to the spread, drop the shorthand (the spread provides it). Where the object has `location: classifyLocation(...)`, just swap to the spread (no trailing `location:` left behind).

- [ ] **Step 5: Update STEP 5 (write to seen-urls)** — at ≈ line 1734, change the entry literal:
```js
seen[r.url] = {
  firstSeen: today(),
  title: r.title,
  source: r.source,
  company: r.company,
  location: r.location || "Unknown",
  ...(r.location_workplace ? {
    location_workplace: r.location_workplace,
    location_city: r.location_city ?? null,
    location_region: r.location_region ?? null,
  } : {}),
  ...(tier ? { source_tier: tier } : {}),
};
```

- [ ] **Step 6: Syntax check** (do NOT run scan-jobs.mjs — it executes `main()` at import / top level and would kick off a live scan)

Run: `node --check scripts/scan-jobs.mjs`
Expected: no output, exit 0.

- [ ] **Step 7: Smoke-test the resolver bundle in isolation**

Run:
```bash
node -e "import('./scripts/lib/location.mjs').then(m => { console.log(m.locationFields('GTM Engineer Hybrid Marina del Rey, CA, USA','https://builtin.com/job/x/1','Hybrid Marina del Rey, CA, USA')); console.log(m.structuredLocationFields('San Francisco', false, 'Hybrid')); })"
```
Expected: `{ location: 'Hybrid · LA area', location_workplace: 'hybrid', location_city: 'marina del rey', location_region: 'ca' }` then `{ location: 'Hybrid · SF Bay', location_workplace: 'hybrid', location_city: 'san francisco', location_region: null }`.

- [ ] **Step 8: Commit**
```bash
git add scripts/scan-jobs.mjs
git commit -m "feat(scan): write structured location (workplace/city/region) to seen-urls

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Dashboard data model

### Task 6: Create the dashboard re-export shim

**Files:**
- Create: `dashboard-web/lib/location-clusters.ts`

- [ ] **Step 1: Write the shim**
```ts
// Re-export of the single-source-of-truth metro module. The actual logic lives in
// scripts/lib/location-clusters.mjs (shared with the scan pipeline); tsconfig has
// allowJs + resolveJsonModule so the .mjs imports cleanly here.
export {
  METRO_CLUSTERS,
  CLUSTER_META,
  CLUSTER_ORDER,
  clusterForCity,
  clusterForLocation,
  flattenLocation,
  parseLocationString,
  looksUS,
} from "../../scripts/lib/location-clusters.mjs";

export type Workplace = "remote" | "hybrid" | "onsite" | "unknown";
export interface StructuredLocation {
  workplace: Workplace;
  city: string | null;
  region: string | null;
}
```

- [ ] **Step 2: Type-check it**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: no errors (or only pre-existing ones unrelated to this file). If `tsc` complains it can't find the `.mjs` module, confirm `allowJs: true` is in `dashboard-web/tsconfig.json` (it is) and that the relative path resolves (`dashboard-web/lib/` → `../../scripts/lib/` → repo-root `scripts/lib/`).

- [ ] **Step 3: Commit**
```bash
git add dashboard-web/lib/location-clusters.ts
git commit -m "feat(dashboard): re-export shared metro-cluster module

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7: Extend the `Role` type

**Files:**
- Modify: `dashboard-web/lib/types.ts`

- [ ] **Step 1: Add the fields** — in the `Role` interface, right after `location: string;`:
```ts
  location: string;
  /** Structured location, populated from seen-urls.json (or parsed from `location` for
   *  legacy entries). `location` above is the display string derived from these. */
  location_workplace: "remote" | "hybrid" | "onsite" | "unknown";
  location_city: string | null;
  /** 2-letter state code for US locations, country name for international, else null. */
  location_region: string | null;
  /** Filter cluster — clusterForLocation() result: "nyc" | "remote" | "sf_bay" | "la"
   *  | "boston" | "seattle" | "austin" | "denver" | "chicago" | "other_us" | "other_intl"
   *  | "unknown". Drives the location filter chips and the stat strip. */
  location_cluster: string;
```

- [ ] **Step 2: Type-check**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: errors only where `Role` objects are constructed without the new fields (i.e. in `lib/data.ts`) — that's expected; fixed in Task 8.

- [ ] **Step 3: Commit**
```bash
git add dashboard-web/lib/types.ts
git commit -m "feat(dashboard): add structured location fields to Role type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 8: Populate the new fields in `lib/data.ts`

**Files:**
- Modify: `dashboard-web/lib/data.ts`

- [ ] **Step 1: Import the helpers** — add near the top of `lib/data.ts`:
```ts
import { clusterForLocation, flattenLocation, parseLocationString } from "./location-clusters";
import type { StructuredLocation } from "./location-clusters";
```

- [ ] **Step 2: Build the structured location.** Locate the existing location block (the one that does `let location = scanData?.location || ""` … through `location = classifyLocation(title, url);`, ≈ lines 257–298). Replace the whole block with:
```ts
    // --- Location ---------------------------------------------------------
    // Prefer the structured fields written by scan-jobs.mjs; fall back to parsing whatever
    // string source we have (scan report → stored string → enrichment.location → enrichment
    // text → title+url), then re-derive the display string and the filter cluster.
    const m = meta as Record<string, unknown>;
    let structured: StructuredLocation;
    if (typeof m.location_workplace === "string") {
      structured = {
        workplace: m.location_workplace as StructuredLocation["workplace"],
        city: (m.location_city as string | null) ?? null,
        region: (m.location_region as string | null) ?? null,
      };
    } else {
      // Legacy entry / fresh-from-enrichment — derive from the best string we can find.
      const storedLocation = (m.location as string) || "";
      let raw =
        (scanData?.location && scanData.location !== "Unknown" && scanData.location) ||
        (storedLocation && storedLocation !== "Unknown" && storedLocation) ||
        (hasEnrichment && typeof enrichment.location === "string" &&
          enrichment.location !== "Not specified" && (enrichment.location as string)) ||
        "";
      structured = parseLocationString(raw);
      if (structured.workplace === "unknown" && !structured.city && hasEnrichment) {
        // last resort: scan the enrichment narrative
        const eText = [
          enrichment.verdict, enrichment.team_context,
          ...((enrichment.green_flags as string[]) || []),
          ...((enrichment.red_flags as string[]) || []),
        ].filter(Boolean).join(" ");
        structured = parseLocationString(eText) ;
      }
      if (structured.workplace === "unknown" && !structured.city) {
        structured = parseLocationString(`${title} ${url}`);
      }
    }
    const location = flattenLocation(structured);
    const locationCluster = clusterForLocation(structured);
```

  > **Note:** `parseLocationString(eText)` over a long narrative is intentionally conservative — it returns `unknown` unless a metro/known-city name actually appears, which is what we want. If it's too eager in practice, tighten `parseLocationString`'s "short residual blob" branch to require the blob be ≤2 words.

- [ ] **Step 3: Add the fields to the pushed `Role`** — in the `roles.push({ … })` literal, after `location,`:
```ts
      location,
      location_workplace: structured.workplace,
      location_city: structured.city,
      location_region: structured.region,
      location_cluster: locationCluster,
```

- [ ] **Step 4: Remove the now-dead local `classifyLocation`** — the `function classifyLocation(title: string, url: string): string { … }` near the bottom of `lib/data.ts` (≈ lines 829–838) is no longer referenced. Delete it. (If `tsc` flags any remaining reference, switch that caller to `flattenLocation(parseLocationString(...))` or `parseLocationString` as appropriate.)

- [ ] **Step 5: Type-check + build**

Run: `cd dashboard-web && npx tsc --noEmit && npm run build`
Expected: clean. Fix any type errors (e.g. `enrichment.location` access guards) until green.

- [ ] **Step 6: Commit**
```bash
git add dashboard-web/lib/data.ts
git commit -m "feat(dashboard): derive structured location + cluster in getRoles()

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Dashboard filter UI

### Task 9: Cluster-first chips in `FilterBar.tsx`

**Files:**
- Modify: `dashboard-web/components/FilterBar.tsx`

- [ ] **Step 1: Swap the bucketing import.** Remove the local `function bucketLocation(loc: string): string { … }` and the `export { bucketLocation };` line. Add at the top:
```ts
import { CLUSTER_META, CLUSTER_ORDER, clusterForLocation } from "@/lib/location-clusters";
```
(The `Filters.locations: Set<string>` now holds cluster keys like `"nyc"`, `"sf_bay"` instead of `"NYC"`/`"Hybrid"`.)

- [ ] **Step 2: Count by `location_cluster`.** In the `for (const r of roles)` loop, replace `const bucket = bucketLocation(r.location); locBucketCounts[bucket] = …` with:
```ts
    const cl = r.location_cluster || "unknown";
    locBucketCounts[cl] = (locBucketCounts[cl] || 0) + 1;
```

- [ ] **Step 3: Build the chip list.** Replace the `const locBuckets = [ … ]` array and the `{locBuckets.map(...)}` render with: chips for `nyc` and `remote` always; every other key in `CLUSTER_ORDER` only when `locBucketCounts[key] > 0`. Colour: `tone === "in-scope"` → `var(--emerald-dim)`; `tone === "unknown"` → `var(--surface-3)`; else `var(--surface-2)` (neutral). Concretely:
```tsx
        {/* Location chips — cluster-first: one click on "NYC area" answers
            "what's inside my geographic constraint?" */}
        <span className="text-[11px] mr-1" style={{ color: "var(--text-muted)" }}>
          <MapPin size={11} className="inline -mt-0.5" /> Location
        </span>
        {CLUSTER_ORDER.filter((k) => k === "nyc" || k === "remote" || (locBucketCounts[k] || 0) > 0).map((k) => {
          const meta = CLUSTER_META[k];
          const color =
            meta.tone === "in-scope" ? "var(--emerald-dim)" :
            meta.tone === "unknown" ? "var(--surface-3)" : undefined;
          return (
            <Chip
              key={k}
              label={meta.label}
              count={locBucketCounts[k] || 0}
              active={filters.locations.has(k)}
              onClick={() => toggleLocation(k)}
              color={color}
            />
          );
        })}
```

- [ ] **Step 4: Keep `toggleLocation` / `clearAll` as-is** (they already operate on the `Set<string>` generically). Confirm `clearAll` resets `locations: new Set()` — it does.

- [ ] **Step 5: Type-check**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: errors now in `PipelineTable.tsx` (it still imports `bucketLocation` from this file) — fixed in Task 10.

- [ ] **Step 6: Commit**
```bash
git add dashboard-web/components/FilterBar.tsx
git commit -m "feat(dashboard): cluster-first location filter chips

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 10: Update `PipelineTable.tsx` filter + sort

**Files:**
- Modify: `dashboard-web/components/PipelineTable.tsx`

- [ ] **Step 1: Drop the `bucketLocation` import** — change `import { FilterBar, bucketLocation } from "./FilterBar";` to `import { FilterBar } from "./FilterBar";`.

- [ ] **Step 2: Filter by cluster** — replace:
```ts
    if (filters.locations.size > 0) {
      filtered = filtered.filter((r) => filters.locations.has(bucketLocation(r.location)));
    }
```
with:
```ts
    if (filters.locations.size > 0) {
      filtered = filtered.filter((r) => filters.locations.has(r.location_cluster || "unknown"));
    }
```

- [ ] **Step 3: Sort the `location` column by cluster order, then display string** — in the `switch (sortKey)`:
```ts
        case "location": {
          const ai = CLUSTER_ORDER.indexOf(a.location_cluster || "unknown");
          const bi = CLUSTER_ORDER.indexOf(b.location_cluster || "unknown");
          cmp = ai !== bi ? ai - bi : a.location.localeCompare(b.location);
          break;
        }
```
Add `import { CLUSTER_ORDER } from "@/lib/location-clusters";` near the top.

- [ ] **Step 4: Type-check + build**

Run: `cd dashboard-web && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**
```bash
git add dashboard-web/components/PipelineTable.tsx
git commit -m "feat(dashboard): filter & sort the pipeline by location cluster

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11: `LocationTag.tsx` colour-by-cluster + stat strip

**Files:**
- Modify: `dashboard-web/components/LocationTag.tsx`
- Modify: `dashboard-web/app/pipeline-client.tsx`

- [ ] **Step 1: Rewrite `LocationTag` to take the cluster + render the display string**
```tsx
import { MapPin } from "lucide-react";
import { CLUSTER_META } from "@/lib/location-clusters";

const TONE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  "in-scope":     { bg: "var(--emerald-dim)", text: "var(--emerald)", border: "rgba(52,211,153,0.15)" },
  "out-of-scope": { bg: "var(--surface-3)",   text: "var(--text-secondary)", border: "var(--border-subtle)" },
  unknown:        { bg: "var(--surface-3)",   text: "var(--text-muted)", border: "var(--border-subtle)" },
};

export function LocationTag({ location, cluster }: { location: string; cluster?: string }) {
  const tone = (cluster && CLUSTER_META[cluster]?.tone) || "unknown";
  const s = TONE_STYLES[tone] || TONE_STYLES.unknown;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      <MapPin size={10} />
      {location}
    </span>
  );
}
```

- [ ] **Step 2: Pass the cluster from `PipelineTable.tsx`** — change `<LocationTag location={role.location} />` to `<LocationTag location={role.location} cluster={role.location_cluster} />`. (Also update any other `<LocationTag …>` call sites — search the dashboard; e.g. `ExpandedRow.tsx`, `CompanyCard.tsx` if present — same change. If a caller doesn't have a `Role` handy, `cluster` is optional and falls back to "unknown" styling.)

- [ ] **Step 3: Cluster-aware stat counts** — in `app/pipeline-client.tsx`, in the `stats` `useMemo`:
```ts
      nycCount: r0.filter((r) => r.location_cluster === "nyc").length,
      remoteCount: r0.filter((r) => r.location_cluster === "remote").length,
```
(Drop the old `r.location.includes("NYC")` / `.toLowerCase().includes("remote")` checks. `StatStrip` already renders `${stats.nycCount} NYC / ${stats.remoteCount} Remote` — no change there. Optionally also patch `lib/data.ts`'s `getStats()` the same way for consistency, lines ≈ 487–525.)

- [ ] **Step 4: Type-check + build**

Run: `cd dashboard-web && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Visual smoke test** (optional but recommended)

Run: `cd dashboard-web && npm run dev`, open the pipeline view, confirm: the location filter row shows `NYC area`, `Remote`, plus `SF Bay` / `LA area` / etc. with counts; clicking `NYC area` hides SF/LA roles; the Location column shows strings like `Hybrid · LA area`.

- [ ] **Step 6: Commit**
```bash
git add dashboard-web/components/LocationTag.tsx dashboard-web/app/pipeline-client.tsx dashboard-web/components/PipelineTable.tsx
git commit -m "feat(dashboard): location tag colours by cluster tone; stats cluster-aware

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Backfill

### Task 12: `scripts/backfill-locations.mjs`

**Files:**
- Create: `scripts/backfill-locations.mjs`

- [ ] **Step 1: Write the script**
```js
#!/usr/bin/env node
// One-shot backfill: upgrade existing data/seen-urls.json entries to the structured location
// model. Reads cached signals only (the existing `location` string, enrichments.json's
// `location` + narrative text, the URL slug, the title) — does NOT re-fetch JDs (that's what
// the next `node scripts/scan-jobs.mjs` run is for). Dry-run by default; pass --write to persist.
//
// Usage:  node scripts/backfill-locations.mjs            # dry run, prints a summary
//         node scripts/backfill-locations.mjs --write    # persist + write a report

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseLocationString, flattenLocation, clusterForLocation } from "./lib/location-clusters.mjs";
import { resolveTextLocation } from "./lib/location.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const ENRICH_PATH = join(ROOT, "data", "enrichments.json");
const WRITE = process.argv.includes("--write");

const seen = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
const enrich = existsSync(ENRICH_PATH) ? JSON.parse(readFileSync(ENRICH_PATH, "utf-8")) : {};

let total = 0, alreadyStructured = 0, gotCity = 0, restructured = 0, stillUnknown = 0, hybridUnclear = 0;
const unresolved = [];

function pickBest(...locs) {
  // Prefer a result with a metro city, then any city, then any known workplace.
  const score = (l) => (l.city && clusterForLocation(l) !== "other_intl" && clusterForLocation(l) !== "other_us" ? 3 : 0)
    + (l.city ? 2 : 0) + (l.workplace !== "unknown" ? 1 : 0);
  return locs.reduce((best, l) => (score(l) > score(best) ? l : best), { workplace: "unknown", city: null, region: null });
}

for (const [url, entry] of Object.entries(seen)) {
  total++;
  if (typeof entry.location_workplace === "string") { alreadyStructured++; continue; }

  const e = enrich[url] || {};
  const fromStored = parseLocationString(entry.location || "");
  const fromEnrichStr = parseLocationString(typeof e.location === "string" ? e.location : "");
  const eText = [e.verdict, e.team_context, ...(e.green_flags || []), ...(e.red_flags || [])].filter(Boolean).join(" ");
  const fromEnrichText = eText ? resolveTextLocation(entry.title || "", url, eText) : { workplace: "unknown", city: null, region: null };
  const fromTitleUrl = resolveTextLocation(entry.title || "", url, "");

  const best = pickBest(fromStored, fromEnrichStr, fromEnrichText, fromTitleUrl);
  const cluster = clusterForLocation(best);
  const flat = flattenLocation(best);

  // bookkeeping
  const hadCityBefore = /,| · /.test(entry.location || "") || /^(San Francisco|Chicago|Boston|Austin|NYC|New York|Hybrid NYC|Remote NYC)/i.test(entry.location || "");
  if (best.city) gotCity++;
  if (!best.city && cluster === "unknown") {
    stillUnknown++;
    if (best.workplace === "hybrid") hybridUnclear++;
    unresolved.push({ url, title: entry.title || "", oldLocation: entry.location || "", workplace: best.workplace });
  } else if (hadCityBefore) {
    restructured++;
  }

  if (WRITE) {
    entry.location = flat;
    entry.location_workplace = best.workplace;
    entry.location_city = best.city;
    entry.location_region = best.region;
  }
}

if (WRITE) {
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
}

const today = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push(`# Location backfill — ${today}${WRITE ? "" : " (DRY RUN — re-run with --write to persist)"}`);
lines.push("");
lines.push(`- Entries scanned: **${total}**`);
lines.push(`- Already structured (skipped): **${alreadyStructured}**`);
lines.push(`- Upgraded with a city anchor: **${gotCity}**`);
lines.push(`- Generic-city strings restructured: **${restructured}**`);
lines.push(`- Still unresolved (no city, cluster=unknown): **${stillUnknown}**  — of which "Hybrid (location unclear)": **${hybridUnclear}**`);
lines.push("");
if (unresolved.length) {
  lines.push(`## Unresolved (${unresolved.length}) — eyeball these`);
  lines.push("");
  lines.push("| Old location | Workplace | Title | URL |");
  lines.push("|---|---|---|---|");
  for (const u of unresolved.slice(0, 200)) {
    lines.push(`| ${u.oldLocation || "—"} | ${u.workplace} | ${u.title.replace(/\|/g, "/")} | ${u.url} |`);
  }
  if (unresolved.length > 200) lines.push(`| … | … | … | _+${unresolved.length - 200} more_ |`);
}
const report = lines.join("\n") + "\n";
console.log(report);
if (WRITE) {
  const dir = join(ROOT, "reports");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `backfill-locations-${today}.md`), report);
  console.log(`\nWrote reports/backfill-locations-${today}.md and updated data/seen-urls.json`);
}
```

- [ ] **Step 2: Dry run**

Run: `node scripts/backfill-locations.mjs`
Expected: a summary table prints; no files change. Sanity-check the numbers (≈1228 scanned; most "Remote US"/"NYC"/"San Francisco" → structured; the 148 "Hybrid" + 338 "Unknown" are the interesting buckets — many "Hybrid" should now get a city from their stored string or enrichment text; "Unknown" mostly stays unknown).

- [ ] **Step 3: Eyeball a few entries the dry run would change** (spot-check correctness before writing). E.g.:
```bash
node -e "
const s=require('./data/seen-urls.json'); const {parseLocationString,flattenLocation,clusterForLocation}=await import('./scripts/lib/location-clusters.mjs');
let n=0; for(const [u,e] of Object.entries(s)){ if(e.location_workplace) continue; const p=parseLocationString(e.location||''); if(++n>25) break; console.log((e.location||'∅').padEnd(22), '→', flattenLocation(p).padEnd(24), clusterForLocation(p)); }
" --input-type=module
```
If anything looks wrong (e.g. "Tempe" not landing as `other_us`, or a metro misfire), fix `parseLocationString` / the cluster lists, re-run Tasks 1–2's tests, repeat.

- [ ] **Step 4: Write it for real**

Run: `node scripts/backfill-locations.mjs --write`
Expected: `data/seen-urls.json` updated; `reports/backfill-locations-<date>.md` written; the report's "Upgraded with a city anchor" / "Still unresolved" counts printed.

- [ ] **Step 5: Verify the dashboard still loads** and `git diff --stat` looks sane (only `data/seen-urls.json` content changed — note `data/seen-urls.json` is gitignored, so it won't show in `git status`; that's expected per the worktree topology).

Run: `cd dashboard-web && npm run build`
Expected: clean.

- [ ] **Step 6: Commit the script + the report** (the data file itself is gitignored)
```bash
git add scripts/backfill-locations.mjs reports/backfill-locations-*.md
git commit -m "feat(scan): backfill structured location onto existing seen-urls entries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Verification

### Task 13: Verify the three named acceptance roles

**Files:** none (verification only — but if any check fails, the fix goes back to Phase 1/2 and re-runs the unit tests)

- [ ] **Step 1: Confirm the unit-test acceptance cases pass**

Run: `npm test`
Expected: PASS — including `resolveTextLocation — Sift Stack …` (→ cluster `la`), `resolveStructuredLocation — Ashby … incident.io` (→ cluster `sf_bay`), and `resolveTextLocation — hybrid in NYC via JD body phrasing` (→ cluster `nyc`).

- [ ] **Step 2: Check the live data for the named roles** (if they're in `seen-urls.json` after the backfill / a scan)

Run:
```bash
node -e "
const s=require('./data/seen-urls.json');
for(const [u,e] of Object.entries(s)){
  if(/builtin\.com\/job\/gtm-engineer\/8996992/.test(u) || /sift/i.test(e.company||'') ) console.log('SIFT?', JSON.stringify(e));
  if(/incident/i.test(u) && /gtm/i.test(e.title||'')) console.log('INCIDENT.IO?', JSON.stringify(e));
  if(/august/i.test(e.company||'')) console.log('AUGUST LAW?', JSON.stringify(e));
}
"
```
Expected, after the backfill (or a fresh scan): Sift's entry has `location_workplace:"hybrid"`, a city in the LA cluster, `location:"Hybrid · LA area"`; incident.io GTM has `"hybrid"` + SF-cluster city; August Law has `"hybrid"` + NYC-cluster city.
> If Sift / incident.io aren't in `seen-urls.json` yet (they surfaced "today" outside the pipeline), this step is informational — the unit tests in Step 1 are the binding check. Optionally run `node scripts/scan-jobs.mjs` to pull them in, then re-check (a full scan takes a few minutes).

- [ ] **Step 3: Dashboard filter behaviour** — `cd dashboard-web && npm run dev`, pipeline view:
  - Filter chip row shows **NYC area**, **Remote**, plus **SF Bay** / **LA area** / **Boston area** / etc. with counts.
  - Click **NYC area** → Sift Stack and incident.io GTM are **gone**; August Law (and other onsite/hybrid-NYC roles) are **shown**.
  - Click **LA area** → Sift Stack appears, tagged `Hybrid · LA area`.
  - The stat strip's "N NYC / M Remote" reflects the new clusters.

- [ ] **Step 4: Pipeline integrity health check** (the structured fields shouldn't have broken anything else)

Run: `node verify-pipeline.mjs`
Expected: passes (or the same warnings as before this branch — diff against `main`).

- [ ] **Step 5: Commit** (nothing to commit if all green; otherwise commit fixes with `fix(location): …` and re-run from Step 1)

### Task 14: Update PHASE_11_TODO + record deferrals

**Files:**
- Modify: `docs/PHASE_11_TODO.md`

- [ ] **Step 1: Append**
```markdown
## Location classification — deferred from the hybrid-CA fix (2026-05-13)

- **International metro sub-clustering.** `clusterForLocation()` currently lumps all non-US
  cities into `other_intl`. Add London area / GTA (Toronto) / Dublin / Berlin / Bengaluru
  etc. as first-class clusters in `scripts/lib/location-clusters.mjs` (`METRO_CLUSTERS`),
  with the dashboard chips following automatically.
- **User-configurable metro clusters.** If the search base changes (move, or expand to a
  second metro), the cluster the dashboard treats as "in scope" should be config-driven —
  e.g. `config/profile.yml: location.in_scope_clusters: [nyc, remote]`, read by
  `lib/location-clusters.ts` consumers and the stat strip, instead of NYC being hard-coded
  as the `in-scope` tone in `CLUSTER_META`.
- **JD re-fetch for the still-`unknown` remainder.** `backfill-locations.mjs` works from
  cached signals only. The roles it leaves as `unknown` / `"Hybrid (location unclear)"` could
  be resolved by re-fetching the JD (JSON-LD `jobLocation` + body) — fold into a future
  `enrich-roles.mjs --relocate` pass rather than a standalone fetcher.

## career-ops upstream update

- `career-ops` upstream is at **v1.7.1**; this fork is on **v1.2.0**. Review santifer's
  changes (`node update-system.mjs check` shows the changelog) before merging into the
  `nick-career-ops` fork — there may be conflicts with the local dashboard / scan-pipeline
  customisations. Not urgent; do it on a quiet day.
```

- [ ] **Step 2: Commit**
```bash
git add docs/PHASE_11_TODO.md
git commit -m "docs: record deferred location work + career-ops upstream-update note

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done criteria

- `npm test` green (cluster module + resolver, incl. the 3 named acceptance cases).
- `cd dashboard-web && npx tsc --noEmit && npm run build` clean.
- `data/seen-urls.json` entries carry `location_workplace` / `location_city` / `location_region`; `location` is the derived `flattenLocation` string.
- Dashboard location filter is cluster-first; clicking **NYC area** excludes hybrid-LA / hybrid-SF roles and includes hybrid-NYC roles.
- `reports/backfill-locations-<date>.md` exists with the upgrade stats.
- `docs/PHASE_11_TODO.md` updated.
- All work on `fix/hybrid-location-classification`; **not pushed** (the user pushes on tomorrow's coordinated push).

## Self-review notes (done while writing this plan)

- **Spec coverage:** scan-jobs `classifyLocation` → structured object ✓ (Tasks 4–5); extraction priority a–e ✓ (`resolveStructuredLocation` covers Ashby field (c); `resolveTextLocation` covers BuiltIn `fa-location-dot` text (a, via the card string scanBuiltIn already passes), JD-body patterns (d), URL-slug (e); JSON-LD (b) is *not* parsed at scan time on `main` — BuiltIn cards give us the location string directly, and Greenhouse/Ashby give structured fields, so JSON-LD parsing is only relevant to the deferred `--relocate` re-fetch; called out in Task 14); `"Hybrid (location unclear)"` fallback + human-review flag ✓ (`flattenLocation` + cluster `unknown` + the backfill's `unresolved` list). Role type fields ✓ (Task 7). Filter restructure to city-first ✓ (Tasks 9–10). Metro clustering const shared between scan & dashboard ✓ (`scripts/lib/location-clusters.mjs` + the dashboard re-export shim — one source, not duplicated). Backfill of seen-urls.json ✓ (Task 12); backfill of enrichments.json — n/a (enrichments has no canonical location field to restructure; its `location` text is *consumed* by the backfill, not rewritten). Verification of the 3 named roles ✓ (Task 13). Stat counts cluster-aware ✓ (Task 11). Phase-11 additions ✓ (Task 14).
- **Placeholders:** none — full code for the three new modules, the backfill, and all edits.
- **Type consistency:** `{workplace, city, region}` shape used identically across `location-clusters.mjs`, `location.mjs`, `data.ts`; `clusterForLocation` return values match `CLUSTER_META` / `CLUSTER_ORDER` keys (asserted by a test in Task 1); `locationFields` / `structuredLocationFields` return the same 4-key shape consumed by scan-jobs STEP 5 and by `data.ts`.
