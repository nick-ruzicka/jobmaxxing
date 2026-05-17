// Append events to daily JSONL files at data/career-ops-events/.
//
// One file per UTC date: career-ops-YYYY-MM-DD.jsonl. Appends are atomic via
// O_APPEND — multiple processes can write without coordination.

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { buildEvent, validateEvent } from "./career-ops-events.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(__dirname, "..", "..", "data", "career-ops-events");

/**
 * Write a built event to the appropriate daily JSONL file.
 *
 * @param {object} event - output of buildEvent()
 * @param {object} [opts]
 * @param {string} [opts.dir] - override events directory (tests)
 * @returns {string} absolute path written
 */
export function writeEvent(event, { dir = DEFAULT_DIR } = {}) {
  validateEvent(event);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const day = event.timestamp.slice(0, 10); // YYYY-MM-DD
  const path = join(dir, `career-ops-${day}.jsonl`);
  appendFileSync(path, JSON.stringify(event) + "\n");
  return path;
}

/**
 * Convenience: build + write in one call.
 */
export function emitEvent({ type, payload, source = "system" }, opts = {}) {
  const event = buildEvent({ type, payload, source });
  writeEvent(event, opts);
  return event;
}

export const EVENTS_DIR = DEFAULT_DIR;
