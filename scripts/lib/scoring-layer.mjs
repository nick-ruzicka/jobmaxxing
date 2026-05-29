// scoring-layer.mjs — additive scoring layer for archetype-aware roles.
//
// Existing fit_score (0–10) feeds in; we multiply by 10 to operate on a
// 0–100 internal scale, apply config-driven adjustments, clamp, and divide
// back to 0–10. Adjustments are itemized so the /context UI can show why a
// role moved.
//
// Order of operations (each step appends a single adjustment per source):
//   1. Hard nos: industries or company signals → score=0, disqualified=true.
//   2. Location adjustment (mapped from role.location_workplace + city).
//   3. Compensation floor.
//   4. Archetype lens: keyword matches in JD scored by reward_signal weights.
//      Primary at full weight, secondary capped at 0.5×.
//   5. Soft preferences (a16z-backed, YC alum, etc.) when JD mentions them.
//   6. Anti-signals (acqui-hire, churn signals) when JD mentions them.

import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { parseYaml } from "./yaml-mini.mjs";
import { getArchetype, getGlobalDisqualifiers, loadArchetypeConfig } from "./archetype-config.mjs";
import { INSTITUTIONAL_BOOST, TITLE_SIGNAL_WEIGHTS } from "./scoring-weights.mjs";
import { extractMinComp, extractMaxComp, compMidpoint } from "./comp-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dirname, "..", "..", "config", "user-context.yaml");

export const SECONDARY_CAP = 0.5; // multiplier applied to secondary archetype's contribution
export const ARCHETYPE_REWARD_CAP = 25; // max points an archetype lens can add per role
export const SCALE = 10; // multiplier between fit_score (0–10) and internal 0–100

let cachedContext = null;

export function loadUserContext(path = DEFAULT_PATH) {
  if (cachedContext === null) {
    cachedContext = parseYaml(readFileSync(path, "utf8"));
  }
  return cachedContext;
}

export function clearUserContextCache() {
  cachedContext = null;
}

/**
 * Apply the additive scoring layer to a role's base fit_score.
 *
 * @param {number} baseScore - fit_score 0–10
 * @param {object} role - { title, company, description, comp_range, location_workplace, location_city, location_region, ... }
 * @param {string|null} archetypePrimary
 * @param {string[]} [archetypeSecondary]
 * @param {object} [opts]
 * @param {object} [opts.userContext]
 * @param {object} [opts.archetypeConfig]
 * @returns {object} { adjusted_score, score_base, adjustments: [{source, delta, reason}], disqualified, disqualification_reason }
 */
export function adjustScore(baseScore, role, archetypePrimary, archetypeSecondary = [], opts = {}) {
  const userContext = opts.userContext ?? loadUserContext();
  const archetypeConfig = opts.archetypeConfig ?? loadArchetypeConfig();
  const globalDQ = getGlobalDisqualifiers(archetypeConfig) ?? {};

  const adjustments = [];

  // Step 1: global hard-no disqualifiers
  const dq = checkDisqualifiers(role, globalDQ, userContext);
  if (dq.disqualified) {
    return {
      adjusted_score: 0,
      score_base: baseScore ?? null,
      adjustments: [{ source: "disqualifier", delta: -(baseScore ?? 0) * SCALE, reason: dq.reason }],
      disqualified: true,
      disqualification_reason: dq.reason,
      clamp_reason: null, // disqualified, not floor-clamped
    };
  }

  // Step 2: location
  const locAdj = locationAdjustment(role, userContext);
  if (locAdj) adjustments.push(locAdj);

  // Step 3: comp floor
  const compAdj = compAdjustment(role, userContext);
  if (compAdj) adjustments.push(compAdj);

  // Step 4: archetype lens (primary + secondary)
  // Per-user archetype-fit gate (v2 productization): if the user's
  // user-context.yaml declares archetype_fit[id].qualified=false, OR the
  // role's archetype_confidence is below the user's configured
  // confidence_floor for that archetype, the lens contribution is skipped.
  // Absent config → no gate (backward-compat default).
  if (archetypePrimary && userQualifiesForArchetype(userContext, archetypePrimary, role)) {
    const a = getArchetype(archetypePrimary, archetypeConfig);
    if (a) {
      const adj = archetypeLensAdjustment(role, a, 1.0);
      if (adj) adjustments.push(adj);
    }
  }
  if (Array.isArray(archetypeSecondary) && archetypeSecondary.length > 0) {
    const secondaryId = archetypeSecondary[0];
    if (userQualifiesForArchetype(userContext, secondaryId, role)) {
      const a = getArchetype(secondaryId, archetypeConfig);
      if (a) {
        const adj = archetypeLensAdjustment(role, a, SECONDARY_CAP);
        if (adj) adjustments.push(adj);
      }
    }
  }

  // Step 5: soft preferences
  adjustments.push(...softPreferenceAdjustments(role, userContext));

  // Step 6: anti-signals
  adjustments.push(...antiSignalAdjustments(role, userContext));

  const totalDelta = adjustments.reduce((sum, a) => sum + a.delta, 0);
  const baseInternal = (baseScore ?? 5) * SCALE;
  const preClampInternal = baseInternal + totalDelta;
  const adjustedInternal = Math.max(0, Math.min(100, preClampInternal));
  let finalScore = Math.round((adjustedInternal / SCALE) * 10) / 10;

  // E4: floor-clamp provenance. When penalties drove the score below 0 (clamped
  // to 0), record the single largest-magnitude negative adjustment so a "great
  // role, killed by location/comp" 0 is distinguishable from a genuine low-fit 0.
  // Provenance only — does NOT affect the score. Null when not floor-clamped.
  let clampReason = null;
  if (preClampInternal < 0) {
    const negatives = adjustments
      .filter((a) => a.delta < 0)
      .sort((x, y) => x.delta - y.delta); // most-negative first
    if (negatives.length > 0) {
      clampReason = `${negatives[0].source} (${negatives[0].delta})`;
    }
  }

  // Phase 1.5: cap at 8.5 when comp:below_floor was suppressed by the trust gate.
  // A perfect 10 on a role with unverified comp is structurally dishonest — the
  // comp could still be below floor. The cap signals "everything we could verify
  // looks great, but the comp check was suppressed so this is provisional."
  const hasCompUnverified = adjustments.some(a => a.source === "comp:below_floor_suppressed");
  if (hasCompUnverified && finalScore > 8.5) {
    finalScore = 8.5;
    adjustments.push({
      source: "ceiling:comp_unverified_cap",
      delta: 0,
      reason: "comp_unverified status caps score at 8.5",
    });
  }

  return {
    adjusted_score: finalScore,
    score_base: baseScore ?? null,
    adjustments,
    disqualified: false,
    disqualification_reason: null,
    clamp_reason: clampReason,
  };
}

// ─── disqualifiers ────────────────────────────────────────────────────────────

function checkDisqualifiers(role, globalDQ, userContext) {
  const body = ((role.description || "") + " " + (role.requirements || "")).toLowerCase();
  const industry = (role.industry || "").toLowerCase();

  const blockedIndustries = [
    ...(globalDQ.industries_blocked ?? []),
    ...(userContext?.hard_nos?.industries ?? []),
  ];
  for (const ind of blockedIndustries) {
    if (industry.includes(ind.toLowerCase()) || body.includes(ind.toLowerCase())) {
      return { disqualified: true, reason: `industry: ${ind}` };
    }
  }

  for (const signal of userContext?.hard_nos?.company_signals ?? []) {
    if (body.includes(signal.toLowerCase().replace(/-/g, " "))) {
      return { disqualified: true, reason: `company-signal: ${signal}` };
    }
  }

  // Location hard-no: `global_disqualifiers.location` in archetypes.yaml carries
  // entries like "fully on-site SF" / "fully on-site Chicago". Until now these
  // were loaded but never read, so the user's stated "no on-site $CITY" deal-
  // breakers were only floor-clamped (-75 location penalty), not explicitly
  // disqualified. This branch makes them DQ properly — observable downstream
  // via `score_disqualified: true`.
  if (role.location_workplace === "onsite") {
    const roleCity = canonLocationDqCity(role.location_city);
    for (const entry of globalDQ.location ?? []) {
      const dqCity = canonLocationDqCity(parseLocationDqCity(entry));
      if (dqCity && roleCity && dqCity === roleCity) {
        return { disqualified: true, reason: `location: ${entry}` };
      }
    }
  }

  return { disqualified: false };
}

// City alias map used by checkDisqualifiers' location branch. Kept separate from
// NYC_CITIES below because the DQ check has a different set of canonical targets
// (only the explicit cities in archetypes.yaml `global_disqualifiers.location`).
const LOCATION_DQ_CITY_ALIASES = new Map([
  ["sf", "san francisco"],
  ["san francisco", "san francisco"],
  ["la", "los angeles"],
  ["los angeles", "los angeles"],
  ["seattle", "seattle"],
  ["austin", "austin"],
  ["chicago", "chicago"],
  ["nyc", "new york"],
  ["new york", "new york"],
  ["new york city", "new york"],
]);

function canonLocationDqCity(s) {
  if (s == null) return null;
  const k = String(s).toLowerCase().trim();
  if (!k) return null;
  return LOCATION_DQ_CITY_ALIASES.get(k) ?? k;
}

// "fully on-site SF" → "sf". "on-site Los Angeles" → "los angeles". Returns null
// if the entry doesn't match the on-site pattern (e.g. accidental "remote first"
// entries should not fire this branch).
function parseLocationDqCity(entry) {
  const m = String(entry || "").toLowerCase().match(/(?:fully\s+)?on-?site\s+(.+?)\s*$/);
  return m ? m[1].trim() : null;
}

// ─── location ─────────────────────────────────────────────────────────────────

const NYC_CITIES = new Set([
  "new york",
  "nyc",
  "new york city",
  "manhattan",
]);
const NYC_AREA_CITIES = new Set([
  "brooklyn",
  "queens",
  "bronx",
  "long island city",
  "lic",
  "jersey city",
  "hoboken",
  "newark",
]);

function locationAdjustment(role, ctx) {
  const prefs = ctx?.location_preferences;
  if (!prefs) return null;
  const workplace = (role.location_workplace || "").toLowerCase();
  const city = (role.location_city || "").toLowerCase();
  const region = (role.location_region || role.location_country || "").toLowerCase();

  let key = null;
  if (workplace === "remote") {
    key = "fully_remote";
  } else if (workplace === "hybrid") {
    if (NYC_CITIES.has(city)) key = "hybrid_nyc";
    else if (NYC_AREA_CITIES.has(city)) key = "hybrid_nyc_area";
    else if (city === "san francisco" || city === "sf") key = "hybrid_sf";
    else if (city === "los angeles" || city === "la") key = "hybrid_la";
    else if (city === "chicago") key = "hybrid_chicago";
    else if (isUS(region, city)) key = "hybrid_other_us";
    else key = "hybrid_international";
  } else if (workplace === "onsite" || workplace === "on-site") {
    if (NYC_CITIES.has(city) || NYC_AREA_CITIES.has(city)) key = "onsite_nyc";
    else if (isUS(region, city)) key = "onsite_other_us";
    else key = "onsite_international";
  } else {
    return null; // unknown workplace, skip
  }

  const delta = prefs[key];
  if (typeof delta !== "number") return null;
  return {
    source: `location:${key}`,
    delta,
    reason: `${role.location_workplace || "?"} ${role.location_city || ""}`.trim(),
  };
}

// US state codes (50 + DC + territories). Checked FIRST in isUS so that 2-letter
// codes that overlap with foreign country codes (CA = California vs Canada,
// DE = Delaware vs Germany, IL = Illinois vs Israel, AR = Arkansas vs Argentina,
// CO = Colorado vs Colombia, IN = Indiana vs India) classify as US.
//
// This was the source of the "California is Canada" bug — `NON_US_CODES.has("ca")`
// returned true, so every California-region role was routed to onsite_international
// (-75) or hybrid_international (-50) instead of the correct onsite_other_us /
// hybrid_other_us bucket.
const US_STATE_CODES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
  "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
  "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
  "wi", "wy",
  "dc",                                    // District of Columbia
  "pr", "gu", "as", "vi", "mp",            // Territories
]);

// US state full names → US. Used when location_region (or location_country
// fallback) carries a full state name instead of the 2-letter code.
const US_STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
  "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
  "washington", "west virginia", "wisconsin", "wyoming",
  "district of columbia",
]);

// Canadian province codes. The mirror image of the California-is-Canada bug —
// without these, "BC" / "ON" / "QC" would fall through the US_STATE_CODES check
// (they're not there) and then hit the legacy 2-letter fallback that defaults
// to US.
const CA_PROVINCE_CODES = new Set([
  "on", "qc", "bc", "ab", "mb", "sk", "ns", "nb", "nl", "pe", "yt", "nt", "nu",
]);

// Canadian province full names → non-US.
const CA_PROVINCE_NAMES = new Set([
  "ontario", "quebec", "british columbia", "alberta", "manitoba",
  "saskatchewan", "nova scotia", "new brunswick",
  "newfoundland and labrador", "newfoundland", "prince edward island",
  "yukon", "northwest territories", "nunavut",
]);

// Major Canadian cities — used to disambiguate ambiguous 2-letter regions like
// "CA" (could be California OR Canada). When the city is unmistakably Canadian
// and the region is the ambiguous "ca", we classify as non-US. Without a city
// signal, "ca" defaults to California (US). Toronto/Montreal/etc. are the
// minimum cases called out in the test brief.
//
// Note: "london" deliberately excluded — London, ON vs London, UK is itself
// ambiguous; safer to require an explicit region signal for London cases.
const CA_CITY_NAMES = new Set([
  "toronto", "montreal", "vancouver", "calgary", "ottawa", "edmonton",
  "winnipeg", "quebec city", "halifax", "victoria", "saskatoon", "regina",
  "mississauga", "brampton", "hamilton", "kitchener",
]);

// Non-US 2-letter codes that don't overlap with US state codes. The overlapping
// codes (CA, DE, IL, AR, CO, IN) are intentionally absent — they're US states
// and isUS() checks US_STATE_CODES first.
const NON_US_CODES = new Set([
  "gb", "uk", "ie", "fr", "es", "it", "nl", "be", "ch", "at", "se", "no",
  "dk", "fi", "pl", "cz", "hu", "pt", "gr", "ro", "tr", "ua", "ru",
  "mx", "br", "cl", "pe",
  "jp", "kr", "cn", "tw", "hk", "sg", "id", "th", "vn", "ph", "my",
  "au", "nz", "ae", "sa", "qa", "kw", "eg", "ng", "ke", "za",
]);

/**
 * Classify a (region, city) pair as US-or-not.
 *
 * Precedence (highest → lowest):
 *   1. Explicit country names ("us"/"usa"/"united states" → US; "canada" → non-US)
 *   2. Full state name (US) or province name (non-US)
 *   3. City-based disambiguation for ambiguous regions: a Canadian city beats
 *      an ambiguous region code
 *   4. 2-letter codes: US states FIRST (the fix), then CA provinces, then other
 *      non-US codes
 *   5. Fallback for unknown 2-letter codes → US (legacy behavior)
 *
 * @param {string|null|undefined} region — location_region OR location_country
 * @param {string|null|undefined} [city] — location_city (optional; used for
 *   ambiguous 2-letter region disambiguation only)
 * @returns {boolean}
 */
export function isUS(region, city) {
  if (!region) return false;
  const r = String(region).toLowerCase();
  const c = (city || "").toLowerCase();

  // 1. Explicit country names
  if (r === "us" || r === "usa" || r === "united states") return true;
  if (r === "canada") return false;

  // 2. Full state / province name
  if (US_STATE_NAMES.has(r)) return true;
  if (CA_PROVINCE_NAMES.has(r)) return false;

  // 3. City-based disambiguation for ambiguous 2-letter regions.
  //    Only applies to "ca" (California vs Canada) — the other overlapping
  //    codes (DE, IL, AR, CO, IN) are biased toward their US state meaning
  //    because that's the more common case in this corpus.
  if (r === "ca" && CA_CITY_NAMES.has(c)) return false;

  // 4. 2-letter codes — US states FIRST. This is the fix.
  if (US_STATE_CODES.has(r)) return true;
  if (CA_PROVINCE_CODES.has(r)) return false;
  if (NON_US_CODES.has(r)) return false;

  // 5. Unknown 2-letter code → assume US (legacy behavior, kept for
  //    backward compatibility with any obscure US territory codes not in
  //    US_STATE_CODES)
  return /^[a-z]{2}$/.test(r);
}

// ─── compensation ─────────────────────────────────────────────────────────────

// Phase 1 comp trust gate. BuiltIn's JSON-LD `baseSalary` is known-unreliable
// (Fix #5): it sometimes carries a generic location/level band rather than the
// posted role's actual comp, and the JD prose Claude reads does not include the
// JSON-LD tag. When the scraped source is `jsonld_basesalary` AND Claude's own
// enrichment (verdict prose or red_flags array) reports "no comp listed", we
// treat the scraped band as unverified and suppress the below_floor penalty.
// A `comp:below_floor_suppressed` adjustment (delta 0) is emitted instead so
// the disagreement is visible in /scan audit trails and dashboard surfaces.
const NO_COMP_PATTERNS = [
  // "no comp listed" / "no compensation mentioned" / "no salary posted" — allows
  // a short prefix like "comp range" between the noun and the predicate.
  /\bno\s+(comp(ensation)?|salary|pay)(\s+\w+){0,2}\s+(listed|mentioned|posted|stated|provided|disclosed|info(rmation)?|transparency|details)\b/i,
  // "comp not listed" / "salary not mentioned"
  /\b(comp(ensation)?|salary|pay)\s+(?:is|was|are|were)?\s*not\s+(listed|mentioned|posted|stated|provided|disclosed)/i,
  // Terse red-flag form: "no comp range" / "no salary range"
  /\bno\s+(comp(ensation)?|salary|pay)\s+range\b/i,
];

function claudeSaysNoComp(text) {
  if (typeof text !== "string" || !text) return false;
  return NO_COMP_PATTERNS.some((re) => re.test(text));
}

// Threshold above which a JSON-LD basesalary value is too specific to be a
// generic role-class placeholder. BuiltIn's known-unreliable bands cluster
// in the $80K-$130K range (default level bands). A max above $150K means the
// JSON-LD almost certainly reflects real posted comp — don't trust Claude's
// possibly-hallucinated "no comp" claim against it.
const COMP_GENERIC_PLACEHOLDER_CEILING = 150000;

/**
 * Trust gate for the comp:below_floor penalty.
 *
 * @param {object} input
 * @param {string} [input.comp_source]   - one of jsonld_basesalary | jsonld_description | jd_prose | jd_estimate | qualitative_only | claude_extracted | none
 * @param {string} [input.comp_range]    - the parsed comp string ("$191K-$249K"). Used to defend against Claude's hallucinated "no comp" claims when the JSON-LD value is clearly real (max >= $150K).
 * @param {string} [input.verdict]       - Claude's prose verdict
 * @param {string[]} [input.red_flags]   - Claude's red-flag array
 * @returns {{ disagrees: boolean, reason: string|null }}
 */
export function detectCompSourceDisagreement({ comp_source, comp_range, verdict, red_flags } = {}) {
  // Source-gated: only the known-unreliable jsonld_basesalary path triggers.
  if (comp_source !== "jsonld_basesalary") {
    return { disagrees: false, reason: null };
  }
  // Defense (added 2026-05-18 after Airtable false-positive): if comp_range
  // has a real numeric max >= $150K, the data is too specific to be a generic
  // BuiltIn placeholder band. Trust JSON-LD over Claude's claim.
  const maxComp = extractMaxComp(comp_range);
  if (maxComp !== null && maxComp >= COMP_GENERIC_PLACEHOLDER_CEILING) {
    return { disagrees: false, reason: null };
  }
  const verdictHit = claudeSaysNoComp(verdict);
  const redFlagHit = Array.isArray(red_flags) && red_flags.some(claudeSaysNoComp);
  if (!verdictHit && !redFlagHit) {
    return { disagrees: false, reason: null };
  }
  const channels = [];
  if (verdictHit) channels.push("verdict");
  if (redFlagHit) channels.push("red_flags");
  return {
    disagrees: true,
    reason: `comp_source=jsonld_basesalary but Claude reports no comp listed in ${channels.join("+")}`,
  };
}

function compAdjustment(role, ctx) {
  const comp = ctx?.compensation;
  if (!comp) return null;
  const rangeStr = (role.comp_range || "").toLowerCase();
  if (!rangeStr || rangeStr === "not listed" || rangeStr === "none") {
    return {
      source: "comp:not_listed",
      delta: comp.no_comp_listed ?? 0,
      reason: "no comp posted",
    };
  }
  const min = extractMinComp(rangeStr);
  if (min === null) return null;
  // Fix D (2026-05-18): compare the range midpoint against the floor, not the
  // min. A band $191K-$249K straddles a $200K floor — midpoint $220K is the
  // more honest "expected" comp. See compMidpoint in comp-parse.mjs.
  const mid = compMidpoint(rangeStr);
  const usedMid = mid !== min;
  if (mid < comp.floor_usd) {
    // Trust gate: contested JSON-LD comp data → suppress penalty, tag for visibility.
    const disagreement = detectCompSourceDisagreement({
      comp_source: role.comp_source,
      comp_range: role.comp_range,
      verdict: role.verdict,
      red_flags: role.red_flags,
    });
    if (disagreement.disagrees) {
      return {
        source: "comp:below_floor_suppressed",
        delta: 0,
        reason: disagreement.reason,
      };
    }
    const label = usedMid ? "mid" : "min";
    return {
      source: "comp:below_floor",
      delta: comp.below_floor_penalty ?? 0,
      reason: `${label} $${mid.toLocaleString()} < floor $${comp.floor_usd.toLocaleString()}`,
    };
  }
  return null;
}

// ─── archetype lens ───────────────────────────────────────────────────────────

/**
 * v2-productization gate. Decides whether the user (per user-context.yaml)
 * qualifies for a given archetype, and whether the role's classification
 * confidence clears the user's per-archetype floor.
 *
 * Returns true when:
 *   - userContext has no archetype_fit block (backward-compat default), OR
 *   - archetype_fit[id] is missing (no per-archetype config for this id), OR
 *   - archetype_fit[id].qualified !== false AND (no confidence_floor OR
 *     role.archetype_confidence >= confidence_floor).
 *
 * Returns false when:
 *   - archetype_fit[id].qualified === false (user is not a fit for this
 *     archetype — zero out the lens contribution), OR
 *   - archetype_fit[id].confidence_floor is set AND
 *     role.archetype_confidence < confidence_floor (classifier wasn't
 *     confident enough for this user to count it).
 *
 * Confidence comes from role.archetype_confidence when present; when absent
 * (e.g. ad-hoc scoring without an enricher pass), the floor check is skipped
 * (we don't penalize for data we don't have).
 */
export function userQualifiesForArchetype(userContext, archetypeId, role = {}) {
  const fit = userContext?.archetype_fit?.[archetypeId];
  if (!fit) return true; // no config → no gate
  if (fit.qualified === false) return false;
  const floor = fit.confidence_floor;
  if (typeof floor === "number" && typeof role.archetype_confidence === "number") {
    if (role.archetype_confidence < floor) return false;
  }
  return true;
}

function archetypeLensAdjustment(role, archetype, multiplier) {
  const title = (role.title || "").toLowerCase();
  const body = ((role.description || "") + " " + (role.requirements || "")).toLowerCase();
  const company = (role.company || "").toLowerCase();

  let raw = 0;
  for (const group of archetype.reward_signals ?? []) {
    for (const kw of group.keywords ?? []) {
      if (body.includes(kw.toLowerCase())) raw += group.weight;
    }
  }
  // Institutional Web3 company boost (companies, not keywords). stablecoin_tier
  // is the strong boost (Paxos, Circle, BitGo, Anchorage, Tether). tier_1 is
  // institutional-but-not-stablecoin (small bump). tier_2 is DeFi (minimal).
  const boost = archetype.institutional_companies_boost;
  if (boost) {
    const w = INSTITUTIONAL_BOOST.scoringLayer;
    if ((boost.stablecoin_tier ?? []).some((c) => company.includes(c.toLowerCase()))) raw += w.stablecoin_tier;
    else if ((boost.tier_1 ?? []).some((c) => company.includes(c.toLowerCase()))) raw += w.tier_1;
    else if ((boost.tier_2 ?? []).some((c) => company.includes(c.toLowerCase()))) raw += w.tier_2;
  }
  // Title-signal bonus (separate channel from the classifier title scoring;
  // here it's a smaller contribution to fit-score uplift)
  const ts = archetype.title_signals ?? {};
  const tw = TITLE_SIGNAL_WEIGHTS.scoringLayer;
  if ((ts.high_match ?? []).some((t) => title.includes(t.toLowerCase()))) raw += tw.high_match;
  else if ((ts.medium_match ?? []).some((t) => title.includes(t.toLowerCase()))) raw += tw.medium_match;

  if (raw === 0) return null;
  const capped = Math.min(ARCHETYPE_REWARD_CAP, raw);
  const delta = Math.round(capped * multiplier);
  return {
    source: `archetype:${archetype.id}${multiplier < 1 ? ":secondary" : ""}`,
    delta,
    reason: `lens raw=${raw} cap=${ARCHETYPE_REWARD_CAP} mult=${multiplier}`,
  };
}

// ─── soft preferences & anti-signals ──────────────────────────────────────────

const SOFT_PREF_PATTERNS = [
  { key: "a16z_portfolio", patterns: ["a16z", "andreessen horowitz"] },
  { key: "paradigm_portfolio", patterns: ["paradigm", "paradigm portfolio"] },
  { key: "yc_alum", patterns: ["y combinator", "yc s2", "yc w2", "yc-backed"] },
  { key: "ex_founder_team", patterns: ["ex-founder", "former founder", "second-time founder"] },
  { key: "diverse_leadership", patterns: ["diverse leadership", "underrepresented", "female-led"] },
];

function softPreferenceAdjustments(role, ctx) {
  const prefs = ctx?.soft_preferences;
  if (!prefs) return [];
  const body = ((role.description || "") + " " + (role.company || "")).toLowerCase();
  const out = [];
  for (const { key, patterns } of SOFT_PREF_PATTERNS) {
    if (patterns.some((p) => body.includes(p))) {
      const delta = prefs[key];
      if (typeof delta === "number" && delta !== 0) {
        out.push({ source: `soft:${key}`, delta, reason: "JD/company marker" });
      }
    }
  }
  return out;
}

const ANTI_SIGNAL_PATTERNS = [
  { key: "acqui_hire_in_last_18_months", patterns: ["acqui-hire", "talent acquisition"] },
  { key: "five_plus_rounds_in_18_months", patterns: ["bridge round", "down round", "extension round"] },
];

function antiSignalAdjustments(role, ctx) {
  const sigs = ctx?.anti_signals;
  if (!sigs) return [];
  const body = ((role.description || "") + " " + (role.company || "")).toLowerCase();
  const out = [];
  for (const { key, patterns } of ANTI_SIGNAL_PATTERNS) {
    if (patterns.some((p) => body.includes(p))) {
      const delta = sigs[key];
      if (typeof delta === "number" && delta !== 0) {
        out.push({ source: `anti:${key}`, delta, reason: "JD marker" });
      }
    }
  }
  return out;
}
