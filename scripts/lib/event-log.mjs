/**
 * event-log.mjs — append-only JSONL event stream for the scraper/enricher pipeline.
 *
 * Design rules (see docs/analytics/ANALYTICS_AUDIT.md §3 for context):
 * - One JSON event per line. Each event has `type`, `ts` (ISO 8601 with ms), and
 *   type-specific payload. Never rewrites existing data.
 * - Default: unbuffered, immediate write. The crash-safety guarantee is per-event.
 *   Callers that emit very-high-volume events (one per HTTP request inside a tier)
 *   should pass `{ batch: true }` and call `flush()` at tier boundaries.
 * - Daily file rotation: events for date YYYY-MM-DD land in
 *   <dir>/YYYY-MM-DD.jsonl. The date used is the event's `ts.slice(0, 10)` so
 *   buffered events written across midnight still rotate correctly.
 * - `DISABLE_EVENT_LOG=true` (env) → all logEvent / flush calls are no-ops.
 * - The default logger writes under <project_root>/data/events/. Tests use a
 *   custom logger via createEventLogger({ dir: <tmp> }).
 *
 * Type taxonomy (extensible — new types must be added here):
 *   scrape.tier_start, scrape.tier_complete
 *   scrape.http_request, scrape.http_error
 *   scrape.parse_success, scrape.parse_failure
 *   scrape.dedup_skip, scrape.filter_reject
 *   scrape.role_discovered
 *   scrape.exa_call
 *   enrich.start, enrich.complete
 *   enrich.claude_call
 *   enrich.skip_quarantined, enrich.error
 *   score.complete
 *   promote.candidate, promote.applied
 *
 * Test coverage: scripts/lib/event-log.test.mjs
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

export const EVENT_TYPES = new Set([
  "scrape.tier_start",
  "scrape.tier_complete",
  "scrape.http_request",
  "scrape.http_error",
  "scrape.parse_success",
  "scrape.parse_failure",
  "scrape.dedup_skip",
  "scrape.filter_reject",
  "scrape.role_discovered",
  "scrape.exa_call",
  "enrich.start",
  "enrich.complete",
  "enrich.claude_call",
  "enrich.skip_quarantined",
  "enrich.error",
  "score.complete",
  "promote.candidate",
  "promote.applied",
]);

const DEFAULT_BUFFER_MAX = 50;

/**
 * Create a scoped event logger.
 *
 * @param {object} opts
 * @param {string} opts.dir            — directory where YYYY-MM-DD.jsonl files are written
 * @param {boolean} [opts.enabled=true] — when false, logEvent/flush become no-ops
 * @param {number} [opts.bufferMax=50] — auto-flush threshold for batched events
 * @returns {{ logEvent: Function, flush: Function, getBuffer: Function }}
 */
export function createEventLogger({ dir, enabled = true, bufferMax = DEFAULT_BUFFER_MAX } = {}) {
  if (!dir && enabled) {
    throw new Error("createEventLogger: `dir` is required when enabled");
  }
  const buffer = [];

  function ensureDir(path) {
    const d = dirname(path);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  function writeOne(event) {
    const date = event.ts.slice(0, 10);
    const file = join(dir, `${date}.jsonl`);
    ensureDir(file);
    appendFileSync(file, JSON.stringify(event) + "\n");
  }

  function logEvent(event, { batch = false } = {}) {
    if (!enabled) return;
    const validated = validateEvent(event);
    if (batch) {
      buffer.push(validated);
      if (buffer.length >= bufferMax) flush();
    } else {
      try {
        writeOne(validated);
      } catch {
        // Never let logging crash the scraper. Drop the event silently.
      }
    }
  }

  function flush() {
    if (!enabled || buffer.length === 0) return;
    const byDate = new Map();
    for (const e of buffer) {
      const date = e.ts.slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(e);
    }
    for (const [date, events] of byDate) {
      const file = join(dir, `${date}.jsonl`);
      try {
        ensureDir(file);
        appendFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      } catch {
        // Drop on disk error; don't crash caller.
      }
    }
    buffer.length = 0;
  }

  // Expose buffer length for tests (read-only).
  function getBuffer() {
    return [...buffer];
  }

  return { logEvent, flush, getBuffer };
}

/**
 * Validate an event payload. Returns the validated event with `ts` injected.
 * Throws Error on invalid input (caller can catch).
 */
export function validateEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("logEvent: event must be a plain object");
  }
  if (typeof input.type !== "string") {
    throw new Error("logEvent: event.type must be a string");
  }
  if (!EVENT_TYPES.has(input.type)) {
    throw new Error(
      `logEvent: unknown event type "${input.type}". Add it to EVENT_TYPES in scripts/lib/event-log.mjs.`,
    );
  }
  let ts = input.ts;
  if (ts === undefined || ts === null) {
    ts = new Date().toISOString();
  } else if (typeof ts !== "string") {
    throw new Error("logEvent: event.ts must be an ISO 8601 string");
  } else if (Number.isNaN(Date.parse(ts))) {
    throw new Error(`logEvent: event.ts is not a valid ISO 8601 timestamp: "${ts}"`);
  }
  // Round-trip via JSON to catch unserializable payloads early.
  let serialized;
  try {
    serialized = JSON.parse(JSON.stringify({ ...input, ts }));
  } catch (err) {
    throw new Error(`logEvent: event is not JSON-serializable (${err.message})`);
  }
  return serialized;
}

// -----------------------------------------------------------------------------
// Default logger — writes to <project_root>/data/events/ unless DISABLE_EVENT_LOG.
// -----------------------------------------------------------------------------

const defaultEnabled = process.env.DISABLE_EVENT_LOG !== "true";
const defaultDir = join(PROJECT_ROOT, "data", "events");
const defaultLogger = createEventLogger({
  dir: defaultDir,
  enabled: defaultEnabled,
});

/** Default-logger `logEvent`. Writes to data/events/YYYY-MM-DD.jsonl. */
export const logEvent = defaultLogger.logEvent;

/** Default-logger `flush`. Force-write any buffered events. */
export const flush = defaultLogger.flush;

/** Internal — exposed for tests; do not rely on this externally. */
export const _defaultDir = defaultDir;
export const _defaultEnabled = defaultEnabled;

// Best-effort flush on process exit / signal.
if (defaultEnabled) {
  process.on("beforeExit", () => {
    try {
      defaultLogger.flush();
    } catch {
      /* swallow */
    }
  });
  process.on("SIGINT", () => {
    try {
      defaultLogger.flush();
    } catch {
      /* swallow */
    }
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    try {
      defaultLogger.flush();
    } catch {
      /* swallow */
    }
    process.exit(143);
  });
}
