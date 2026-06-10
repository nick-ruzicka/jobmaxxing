// Canonical accessor for the scheduled_tasks block in config/user-context.yaml.
// Mirrors the pattern of comp-floor.mjs: parse via yaml-mini, cache per-process.
//
// Contract: every scheduled task defaults to DISABLED. A task only runs from
// cron when the user has explicitly opted in:
//
//   scheduled_tasks:
//     regenerate_briefing: true
//
// Consumed by scripts/generate-briefing.mjs (--from-cron gate). A missing
// user-context.yaml, a missing scheduled_tasks block, or a non-boolean value
// all resolve to false — cron must never run a paid LLM call the user didn't
// ask for.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./yaml-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONTEXT_PATH = path.resolve(__dirname, "..", "..", "config", "user-context.yaml");

export const KNOWN_SCHEDULED_TASKS = ["regenerate_briefing"];

/** Pure resolver — exported for tests. */
export function resolveScheduledTask(userContext, taskName) {
  const block = userContext?.scheduled_tasks;
  if (block == null || typeof block !== "object") return false;
  return block[taskName] === true;
}

let cachedContext;

function loadUserContext() {
  if (cachedContext !== undefined) return cachedContext;
  try {
    cachedContext = parseYaml(readFileSync(USER_CONTEXT_PATH, "utf8"));
  } catch {
    cachedContext = null;
  }
  return cachedContext;
}

export function isScheduledTaskEnabled(taskName) {
  return resolveScheduledTask(loadUserContext(), taskName);
}

/** Test hook — clears the per-process cache. */
export function _resetScheduledTasksCache() {
  cachedContext = undefined;
}
