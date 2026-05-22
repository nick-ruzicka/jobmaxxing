// Company-archetype matcher for /signals.
//
// Cross-references signal companies with pipeline roles to determine
// which archetypes a company matches. Also computes hiring velocity
// from role counts.
//
// Public:
//   matchSignalCompanies(signals, roles, enrichments, archetypes)
//     → Map<slug, { archetypes_matched, archetype_roles_count, hiring_velocity, total_roles }>

import { companyKey } from "./normalize-company.mjs";
import { getAllArchetypes } from "./archetype-config.mjs";
import { PRIMARY_ARCHETYPES, companyCandidateKeys } from "./company-matching.mjs";

// Hiring velocity thresholds
const VELOCITY_THRESHOLDS = { cold: 0, warming: 1, hot: 3, on_fire: 10 };

/**
 * Classify hiring velocity from archetype-matched role count.
 * @param {number} count
 * @returns {"cold"|"warming"|"hot"|"on_fire"}
 */
export function classifyVelocity(count) {
  if (count >= VELOCITY_THRESHOLDS.on_fire) return "on_fire";
  if (count >= VELOCITY_THRESHOLDS.hot) return "hot";
  if (count >= VELOCITY_THRESHOLDS.warming) return "warming";
  return "cold";
}

/**
 * Build a company→archetype match map for signal companies.
 *
 * Strategy:
 * 1. Group pipeline roles by companyKey
 * 2. For each role with enrichment.archetype_primary, count per company
 * 3. For signal companies with no roles, check institutional_companies_boost
 * 4. Companies with 0 archetype matches are "out of scope"
 *
 * @param {Array<{slug:string, name:string}>} signals
 * @param {Record<string,{company?:string}>} seenUrls
 * @param {Record<string,{archetype_primary?:string}>} enrichments
 * @param {object} [opts]
 * @param {object[]} [opts.archetypes] - override loaded config (tests)
 * @returns {Map<string, CompanyMatch>}
 */
export function matchSignalCompanies(signals, seenUrls, enrichments, opts = {}) {
  const archetypes = opts.archetypes ?? getAllArchetypes(opts.config);

  // Step 1: Build role→company index (using companyKey for matching)
  // Store under all candidate keys so fuzzy lookups find them.
  const companyRoles = new Map(); // companyKey → { archetypes: Map<id, count>, totalRoles: number }
  for (const [url, role] of Object.entries(seenUrls)) {
    if (!role || !role.company) continue;
    const ck = companyKey(role.company);
    if (!companyRoles.has(ck)) {
      const entry = { archetypes: new Map(), totalRoles: 0 };
      companyRoles.set(ck, entry);
      // Register suffix-stripped aliases pointing to same object
      for (const alias of companyCandidateKeys(role.company)) {
        if (alias !== ck && !companyRoles.has(alias)) {
          companyRoles.set(alias, entry);
        }
      }
    }
    const entry = companyRoles.get(ck);
    entry.totalRoles++;

    // Check enrichment for archetype
    const enrichment = enrichments[url];
    if (enrichment && enrichment.archetype_primary) {
      const current = entry.archetypes.get(enrichment.archetype_primary) || 0;
      entry.archetypes.set(enrichment.archetype_primary, current + 1);
    }
  }

  // Step 2: Build institutional company lookup from archetypes config
  const institutionalMap = new Map(); // companyKey → archetype id
  for (const a of archetypes) {
    const boost = a.institutional_companies_boost;
    if (!boost) continue;
    const tiers = ["stablecoin_tier", "tier_1", "tier_2"];
    for (const tier of tiers) {
      const companies = boost[tier];
      if (!Array.isArray(companies)) continue;
      for (const name of companies) {
        institutionalMap.set(companyKey(name), a.id);
      }
    }
  }

  // Step 3: Match each signal company
  const results = new Map();
  for (const signal of signals) {
    // Candidates from both the slug and the display name, each normalized the
    // same way as the role index (companyKey + suffix-strip + dedup) so signals
    // resolve to the same company keys as the pipeline roles. (A2 fix: the slug
    // path used to skip companyKey normalization, diverging from the role side.)
    const allCandidates = [
      ...new Set([...companyCandidateKeys(signal.slug), ...companyCandidateKeys(signal.name)]),
    ];
    let roleData = null;
    for (const candidate of allCandidates) {
      if (companyRoles.has(candidate)) {
        roleData = companyRoles.get(candidate);
        break;
      }
    }

    let archetypesMatched = [];
    let archetypeRolesCount = 0;
    let totalRoles = 0;

    if (roleData) {
      // Company has pipeline roles — use enrichment data
      totalRoles = roleData.totalRoles;
      for (const [archId, count] of roleData.archetypes) {
        if (PRIMARY_ARCHETYPES.includes(archId)) {
          archetypesMatched.push(archId);
          archetypeRolesCount += count;
        }
      }
    } else {
      // No pipeline roles — check institutional lists (with fuzzy matching)
      let instArchetype = null;
      for (const candidate of allCandidates) {
        instArchetype = institutionalMap.get(candidate);
        if (instArchetype) break;
      }
      if (instArchetype && PRIMARY_ARCHETYPES.includes(instArchetype)) {
        archetypesMatched.push(instArchetype);
      }
    }

    results.set(signal.slug, {
      archetypes_matched: archetypesMatched,
      archetype_roles_count: archetypeRolesCount,
      total_roles: totalRoles,
      hiring_velocity: classifyVelocity(archetypeRolesCount),
      has_pipeline_roles: totalRoles > 0,
    });
  }

  return results;
}

/**
 * Filter threshold: company passes if it has at least one archetype match.
 * @param {object} match - from matchSignalCompanies
 * @returns {boolean}
 */
export function passesArchetypeFilter(match) {
  return match.archetypes_matched.length > 0;
}

/**
 * Classify match status for hierarchy placement.
 * - "confirmed_match": has archetype-matched pipeline roles → promote to top
 * - "confirmed_no_match": has pipeline roles but NONE match → demote/hide
 * - "unknown": no pipeline roles yet → keep visible based on signal result
 *
 * @param {object} match - from matchSignalCompanies
 * @returns {"confirmed_match"|"confirmed_no_match"|"unknown"}
 */
export function matchStatus(match) {
  if (match.archetypes_matched.length > 0) return "confirmed_match";
  if (match.has_pipeline_roles && match.total_roles > 0) return "confirmed_no_match";
  return "unknown";
}
