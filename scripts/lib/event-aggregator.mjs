// Read + aggregate events from data/career-ops-events/.
//
// Consumers:
//   - Dashboard /context route surfaces (G6) — recent events per role.
//   - Meta-scorer (G7) — patterns across many events to propose new rules.

import { readdirSync, readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { EVENT_TYPES } from "./career-ops-events.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(__dirname, "..", "..", "data", "career-ops-events");

/**
 * Read every event from the daily JSONL files, optionally filtered by date.
 *
 * @param {object} [opts]
 * @param {string} [opts.dir]
 * @param {string} [opts.since] - YYYY-MM-DD inclusive
 * @param {string} [opts.until] - YYYY-MM-DD inclusive
 * @param {string} [opts.type] - event type filter
 * @param {string} [opts.role_id] - role filter
 * @returns {object[]}
 */
export function readEvents({
  dir = DEFAULT_DIR,
  since = null,
  until = null,
  type = null,
  role_id = null,
} = {}) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /^career-ops-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort();

  const events = [];
  for (const file of files) {
    const day = file.slice("career-ops-".length, "career-ops-".length + 10);
    if (since && day < since) continue;
    if (until && day > until) continue;
    const raw = readFileSync(join(dir, file), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // skip malformed (resilient)
      }
      if (type && event.type !== type) continue;
      if (role_id && event.role_id !== role_id) continue;
      events.push(event);
    }
  }
  return events;
}

/**
 * Count events grouped by type.
 *
 * @returns {Record<string, number>}
 */
export function byType(opts = {}) {
  const events = readEvents(opts);
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  return counts;
}

/**
 * All events tagged with a given role_id, oldest first.
 */
export function byRole(role_id, opts = {}) {
  return readEvents({ ...opts, role_id });
}

/**
 * Detect simple action-correlated patterns.
 *
 * Looks for cases where a specific event type (e.g., role.dismissed) is
 * preceded within `windowSec` by another event on the same role_id (e.g.,
 * role.archetype_classified). Returns counts so meta-scorer can decide if a
 * rule should be proposed.
 *
 * @param {object} opts
 * @param {string} opts.outcomeType - the event we're investigating (e.g. "role.dismissed")
 * @param {string[]} [opts.precedingTypes] - antecedents to look for
 * @param {number} [opts.windowSec=86400] - max delta seconds between events
 * @returns {object} { outcome_count, pattern_counts: {precedingType: count}, samples }
 */
export function byPattern({ outcomeType, precedingTypes = [], windowSec = 86400, dir } = {}) {
  if (!outcomeType || !Object.prototype.hasOwnProperty.call(EVENT_TYPES, outcomeType)) {
    throw new Error(`byPattern requires a known outcomeType, got ${outcomeType}`);
  }
  const events = readEvents({ dir });
  // Group by role_id
  const byRoleMap = new Map();
  for (const e of events) {
    if (!e.role_id) continue;
    if (!byRoleMap.has(e.role_id)) byRoleMap.set(e.role_id, []);
    byRoleMap.get(e.role_id).push(e);
  }
  let outcomeCount = 0;
  const patternCounts = {};
  const samples = [];
  for (const [role_id, list] of byRoleMap) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type !== outcomeType) continue;
      outcomeCount++;
      const outcomeTime = Date.parse(e.timestamp);
      // Look at antecedents on the same role within window
      for (let j = i - 1; j >= 0; j--) {
        const prior = list[j];
        const priorTime = Date.parse(prior.timestamp);
        if ((outcomeTime - priorTime) / 1000 > windowSec) break;
        if (precedingTypes.length === 0 || precedingTypes.includes(prior.type)) {
          patternCounts[prior.type] = (patternCounts[prior.type] || 0) + 1;
          if (samples.length < 5) {
            samples.push({ role_id, outcome: e, antecedent: prior });
          }
        }
      }
    }
  }
  return { outcome_count: outcomeCount, pattern_counts: patternCounts, samples };
}
