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
    };
  }

  // Step 2: location
  const locAdj = locationAdjustment(role, userContext);
  if (locAdj) adjustments.push(locAdj);

  // Step 3: comp floor
  const compAdj = compAdjustment(role, userContext);
  if (compAdj) adjustments.push(compAdj);

  // Step 4: archetype lens (primary + secondary)
  if (archetypePrimary) {
    const a = getArchetype(archetypePrimary, archetypeConfig);
    if (a) {
      const adj = archetypeLensAdjustment(role, a, 1.0);
      if (adj) adjustments.push(adj);
    }
  }
  if (Array.isArray(archetypeSecondary) && archetypeSecondary.length > 0) {
    const a = getArchetype(archetypeSecondary[0], archetypeConfig);
    if (a) {
      const adj = archetypeLensAdjustment(role, a, SECONDARY_CAP);
      if (adj) adjustments.push(adj);
    }
  }

  // Step 5: soft preferences
  adjustments.push(...softPreferenceAdjustments(role, userContext));

  // Step 6: anti-signals
  adjustments.push(...antiSignalAdjustments(role, userContext));

  const totalDelta = adjustments.reduce((sum, a) => sum + a.delta, 0);
  const baseInternal = (baseScore ?? 5) * SCALE;
  const adjustedInternal = Math.max(0, Math.min(100, baseInternal + totalDelta));

  return {
    adjusted_score: Math.round((adjustedInternal / SCALE) * 10) / 10,
    score_base: baseScore ?? null,
    adjustments,
    disqualified: false,
    disqualification_reason: null,
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

  return { disqualified: false };
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
    else if (isUS(region)) key = "hybrid_other_us";
    else key = "hybrid_international";
  } else if (workplace === "onsite" || workplace === "on-site") {
    if (NYC_CITIES.has(city) || NYC_AREA_CITIES.has(city)) key = "onsite_nyc";
    else if (isUS(region)) key = "onsite_other_us";
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

// Common non-US 2-letter region/country codes we see on remote job boards.
// Anything else 2-letter is assumed to be a US state.
const NON_US_CODES = new Set([
  "gb", "uk", "ie", "de", "fr", "es", "it", "nl", "be", "ch", "at", "se", "no",
  "dk", "fi", "pl", "cz", "hu", "pt", "gr", "ro", "tr", "il", "ua", "ru",
  "ca", "mx", "br", "ar", "cl", "co", "pe",
  "jp", "kr", "cn", "tw", "hk", "sg", "in", "id", "th", "vn", "ph", "my",
  "au", "nz", "ae", "sa", "qa", "kw", "eg", "ng", "ke", "za",
]);

function isUS(region) {
  if (!region) return false;
  const r = region.toLowerCase();
  if (r === "us" || r === "usa" || r === "united states") return true;
  if (NON_US_CODES.has(r)) return false;
  return /^[a-z]{2}$/.test(r); // 2-letter and not on the non-US list → US state
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

/**
 * Trust gate for the comp:below_floor penalty.
 *
 * @param {object} input
 * @param {string} [input.comp_source]   - one of jsonld_basesalary | jsonld_description | jd_prose | jd_estimate | qualitative_only | claude_extracted | none
 * @param {string} [input.verdict]       - Claude's prose verdict
 * @param {string[]} [input.red_flags]   - Claude's red-flag array
 * @returns {{ disagrees: boolean, reason: string|null }}
 */
export function detectCompSourceDisagreement({ comp_source, verdict, red_flags } = {}) {
  // Source-gated: only the known-unreliable jsonld_basesalary path triggers.
  if (comp_source !== "jsonld_basesalary") {
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
  if (min < comp.floor_usd) {
    // Trust gate: contested JSON-LD comp data → suppress penalty, tag for visibility.
    const disagreement = detectCompSourceDisagreement({
      comp_source: role.comp_source,
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
    return {
      source: "comp:below_floor",
      delta: comp.below_floor_penalty ?? 0,
      reason: `min $${min.toLocaleString()} < floor $${comp.floor_usd.toLocaleString()}`,
    };
  }
  return null;
}

function extractMinComp(s) {
  // Patterns like "$150k - $200k", "$150,000 to $200,000", "$150,000+", "150-200k"
  const norm = s.replace(/,/g, "");
  const dollar = norm.match(/\$?(\d+(?:\.\d+)?)\s*(k|m)?/i);
  if (!dollar) return null;
  let n = parseFloat(dollar[1]);
  const suffix = (dollar[2] || "").toLowerCase();
  if (suffix === "k") n *= 1000;
  else if (suffix === "m") n *= 1000000;
  else if (n < 1000) n *= 1000; // bare "150" → 150,000
  return n;
}

// ─── archetype lens ───────────────────────────────────────────────────────────

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
    if ((boost.stablecoin_tier ?? []).some((c) => company.includes(c.toLowerCase()))) raw += 35;
    else if ((boost.tier_1 ?? []).some((c) => company.includes(c.toLowerCase()))) raw += 12;
    else if ((boost.tier_2 ?? []).some((c) => company.includes(c.toLowerCase()))) raw += 6;
  }
  // Title-signal bonus (separate channel from the classifier title scoring;
  // here it's a smaller contribution to fit-score uplift)
  const ts = archetype.title_signals ?? {};
  if ((ts.high_match ?? []).some((t) => title.includes(t.toLowerCase()))) raw += 8;
  else if ((ts.medium_match ?? []).some((t) => title.includes(t.toLowerCase()))) raw += 4;

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
  { key: "glassdoor_below_3_5", patterns: [] }, // requires external data; skipped at JD time
];

function antiSignalAdjustments(role, ctx) {
  const sigs = ctx?.anti_signals;
  if (!sigs) return [];
  const body = ((role.description || "") + " " + (role.company || "")).toLowerCase();
  const out = [];
  for (const { key, patterns } of ANTI_SIGNAL_PATTERNS) {
    if (patterns.length === 0) continue;
    if (patterns.some((p) => body.includes(p))) {
      const delta = sigs[key];
      if (typeof delta === "number" && delta !== 0) {
        out.push({ source: `anti:${key}`, delta, reason: "JD marker" });
      }
    }
  }
  return out;
}
