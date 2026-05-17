// Event schema for the career-ops feedback loop.
//
// Every event has a stable shape:
//   { id, timestamp, type, source, payload, role_id?, archetype? }
//
// `payload` carries type-specific fields. Top-level `role_id` / `archetype`
// are denormalized for fast filtering by aggregator (G7 meta-scorer reads
// these directly).

import { randomUUID } from "crypto";

// 20 event types covering role interaction, archetype, score, resume, context,
// onboarding, and backtest. Schema gates validation in event-writer.
export const EVENT_TYPES = Object.freeze({
  // Role interaction
  "role.viewed": { required: ["role_id"] },
  "role.dismissed": { required: ["role_id"] },
  "role.pinned": { required: ["role_id"] },
  "role.starred": { required: ["role_id"] },
  "role.hidden": { required: ["role_id"] },
  "role.applied": { required: ["role_id"] },

  // Archetype
  "role.archetype_classified": { required: ["role_id", "archetype"] },
  "role.archetype_corrected": { required: ["role_id", "from_archetype", "to_archetype"] },

  // Score
  "score.viewed": { required: ["role_id"] },
  "score.overridden": { required: ["role_id", "from_score", "to_score"] },
  "score.confirmed": { required: ["role_id", "score"] },

  // Resume
  "resume.selected": { required: ["role_id", "archetype", "resume_path"] },
  "resume.tweaked": { required: ["role_id", "archetype"] },

  // Context
  "context.preference_set": { required: ["key", "value"] },
  "context.archetype_tuned": { required: ["archetype", "changes"] },

  // Onboarding
  "onboarding.step_completed": { required: ["step"] },
  "onboarding.example_provided": { required: ["archetype", "example_kind"] },

  // Backtest
  "backtest.rule_proposed": { required: ["rule_id", "rule"] },
  "backtest.rule_accepted": { required: ["rule_id"] },
  "backtest.rule_rejected": { required: ["rule_id"] },
});

export const VALID_SOURCES = Object.freeze(["dashboard", "cli", "system", "test"]);

/**
 * Build a validated event ready for persistence.
 *
 * @param {object} input
 * @param {string} input.type - one of EVENT_TYPES keys
 * @param {object} input.payload - type-specific fields (must satisfy required)
 * @param {string} [input.source] - origin tag, defaults to 'system'
 * @returns {object} { id, timestamp, type, source, payload, role_id?, archetype? }
 */
export function buildEvent({ type, payload = {}, source = "system" }) {
  if (!Object.prototype.hasOwnProperty.call(EVENT_TYPES, type)) {
    throw new Error(`unknown event type: ${type}`);
  }
  if (!VALID_SOURCES.includes(source)) {
    throw new Error(`invalid source '${source}' (expected one of ${VALID_SOURCES.join(", ")})`);
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`event payload must be an object, got ${typeof payload}`);
  }
  const required = EVENT_TYPES[type].required ?? [];
  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      throw new Error(`event '${type}' missing required payload field '${field}'`);
    }
  }
  const event = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    source,
    payload,
  };
  // Denormalize role_id and archetype for fast filtering by aggregator
  if (payload.role_id) event.role_id = payload.role_id;
  if (payload.archetype) event.archetype = payload.archetype;
  return event;
}

/**
 * Validate an already-built event (e.g., parsed from JSONL or POSTed).
 * Returns true on valid, throws otherwise.
 */
export function validateEvent(event) {
  if (!event || typeof event !== "object") throw new Error("event must be an object");
  if (!event.id || typeof event.id !== "string") throw new Error("event.id required");
  if (!event.timestamp || isNaN(Date.parse(event.timestamp))) throw new Error("event.timestamp must be ISO");
  if (!Object.prototype.hasOwnProperty.call(EVENT_TYPES, event.type)) {
    throw new Error(`unknown event type: ${event.type}`);
  }
  if (!VALID_SOURCES.includes(event.source)) {
    throw new Error(`invalid source '${event.source}'`);
  }
  if (event.payload === null || typeof event.payload !== "object") {
    throw new Error("event.payload must be an object");
  }
  for (const field of EVENT_TYPES[event.type].required ?? []) {
    if (event.payload[field] === undefined || event.payload[field] === null || event.payload[field] === "") {
      throw new Error(`event '${event.type}' missing required field '${field}'`);
    }
  }
  return true;
}
