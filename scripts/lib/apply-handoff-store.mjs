// In-memory TTL store for the CareerOps → extension Apply handoff.
//
// Lives in process memory of the dashboard-web server. A handoff is a small
// JSON blob (role_id, archetype, apply_url, resume HTML, profile) created
// when the user clicks Apply in /pipeline and consumed by the extension on
// the apply page. 5-minute TTL — enough time for the user to actually open
// and start filling, well under any session boundary.

import { randomUUID } from "crypto";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

const store = new Map();

/**
 * Persist a handoff and return its id. The caller (the dashboard's Apply
 * button) opens apply_url with ?career_ops_handoff=<id> so the extension
 * can fetch it back.
 *
 * @param {object} payload - role_id, archetype, apply_url, resume_html, profile
 * @returns {string} handoff_id
 */
export function createHandoff(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("createHandoff: payload must be an object");
  }
  if (!payload.apply_url || typeof payload.apply_url !== "string") {
    throw new Error("createHandoff: apply_url is required");
  }
  pruneExpired();
  const id = randomUUID();
  store.set(id, {
    payload,
    created_at: Date.now(),
    consumed_at: null,
  });
  return id;
}

/**
 * Retrieve a handoff by id. Returns null if missing or expired. By default
 * marks the handoff as consumed (one-shot) but the caller can opt out by
 * passing { peek: true } — useful for the API GET path when the same handoff
 * might be re-fetched on retry.
 */
export function readHandoff(id, { peek = false } = {}) {
  pruneExpired();
  const entry = store.get(id);
  if (!entry) return null;
  if (Date.now() - entry.created_at > TTL_MS) {
    store.delete(id);
    return null;
  }
  if (!peek) {
    entry.consumed_at = Date.now();
  }
  return entry.payload;
}

/**
 * Visible count for tests / introspection.
 */
export function size() {
  pruneExpired();
  return store.size;
}

/**
 * Reset store. For tests.
 */
export function _resetForTests() {
  store.clear();
}

function pruneExpired() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.created_at > TTL_MS) store.delete(id);
  }
}

export const HANDOFF_TTL_MS = TTL_MS;
