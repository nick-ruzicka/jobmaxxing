// archetype-config.mjs — load and query config/archetypes.yaml.
//
// Consumed by the hybrid classifier (G3) and the additive scoring layer (G4).
//
// Public API:
//   loadArchetypeConfig(path?) → { archetypes: [...], global_disqualifiers: {...} }
//   getArchetype(id, config?) → archetype object or undefined
//   getAllArchetypes(config?) → array of archetype objects (cached)
//   getGlobalDisqualifiers(config?) → global disqualifiers object
//   ARCHETYPE_IDS → array of valid archetype ids

import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { parseYaml } from "./yaml-mini.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dirname, "..", "..", "config", "archetypes.yaml");

export const ARCHETYPE_IDS = [
  "gtm-engineering",
  "ai-operations",
  "fde",
  "web3-bd",
  "web3-bizops",
];

const REQUIRED_FIELDS = ["id", "name", "description", "maturity", "resume"];
// Maturity taxonomy:
//   primary     — aspirational target archetype (gtm-engineering, ai-operations, fde)
//   conditional — only fires under specific signals (future: revops-technical)
//   fallback    — experience exists but only under sub-conditions (web3-* when
//                 stablecoin-adjacent)
const VALID_MATURITY = new Set(["primary", "conditional", "fallback"]);

let _cached = null;

export function loadArchetypeConfig(path = DEFAULT_PATH) {
  const text = readFileSync(path, "utf8");
  const raw = parseYaml(text);
  validate(raw);
  resolveInheritance(raw);
  return raw;
}

export function getArchetype(id, config = null) {
  const c = config ?? cached();
  return c.archetypes.find((a) => a.id === id);
}

export function getAllArchetypes(config = null) {
  return (config ?? cached()).archetypes;
}

export function getGlobalDisqualifiers(config = null) {
  return (config ?? cached()).global_disqualifiers;
}

export function clearCache() {
  _cached = null;
}

function cached() {
  if (_cached === null) _cached = loadArchetypeConfig();
  return _cached;
}

function validate(config) {
  if (!config || typeof config !== "object") {
    throw new Error("archetypes.yaml: top-level must be a mapping");
  }
  const archetypes = config.archetypes;
  if (!Array.isArray(archetypes)) {
    throw new Error("archetypes.yaml: `archetypes` must be a list");
  }
  if (archetypes.length === 0) {
    throw new Error("archetypes.yaml: `archetypes` is empty");
  }

  const seenIds = new Set();
  for (const a of archetypes) {
    for (const field of REQUIRED_FIELDS) {
      if (a[field] === undefined || a[field] === null || a[field] === "") {
        throw new Error(`archetypes.yaml: archetype missing required field '${field}': ${JSON.stringify(a)}`);
      }
    }
    if (!VALID_MATURITY.has(a.maturity)) {
      throw new Error(`archetypes.yaml: invalid maturity '${a.maturity}' for ${a.id} (expected: primary | conditional | fallback)`);
    }
    if (seenIds.has(a.id)) {
      throw new Error(`archetypes.yaml: duplicate archetype id '${a.id}'`);
    }
    seenIds.add(a.id);

    if (a.reward_signals && !Array.isArray(a.reward_signals)) {
      throw new Error(`archetypes.yaml: ${a.id}.reward_signals must be a list`);
    }
    if (Array.isArray(a.reward_signals)) {
      for (const rs of a.reward_signals) {
        if (!Array.isArray(rs.keywords) || typeof rs.weight !== "number") {
          throw new Error(`archetypes.yaml: ${a.id} reward_signal must have keywords[] and numeric weight`);
        }
      }
    }
  }

  const gd = config.global_disqualifiers;
  if (gd != null) {
    if (typeof gd !== "object" || Array.isArray(gd)) {
      throw new Error("archetypes.yaml: global_disqualifiers must be a mapping");
    }
  }
}

function resolveInheritance(config) {
  // Resolve `inherit_from: <other-archetype-id>` references on the
  // institutional_companies_boost field (the only inheritable section).
  const byId = new Map(config.archetypes.map((a) => [a.id, a]));
  for (const a of config.archetypes) {
    const boost = a.institutional_companies_boost;
    if (!boost || typeof boost !== "object") continue;
    if (boost.inherit_from) {
      const source = byId.get(boost.inherit_from);
      if (!source) {
        throw new Error(`archetypes.yaml: ${a.id}.institutional_companies_boost.inherit_from references unknown archetype '${boost.inherit_from}'`);
      }
      if (!source.institutional_companies_boost) {
        throw new Error(`archetypes.yaml: ${a.id} inherits from ${boost.inherit_from} but that archetype has no institutional_companies_boost`);
      }
      a.institutional_companies_boost = JSON.parse(JSON.stringify(source.institutional_companies_boost));
    }
  }
}
