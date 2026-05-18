// Canonical accessor for the comp floor (compensation.floor_usd) defined in
// config/user-context.yaml. Mirrors the pattern used by scoring-layer.mjs's
// loadUserContext() — parses the YAML via yaml-mini.mjs, caches per-process.
//
// Used by:
//   - scripts/generate-briefing.mjs    (goal-fallback string)
//   - scripts/lib/comp-floor-consistency.test.mjs (drift gate)
//
// Cross-runtime sibling: dashboard-web/lib/comp-floor.ts (reads the same YAML).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./yaml-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONTEXT_PATH = path.resolve(__dirname, "..", "..", "config", "user-context.yaml");

let cachedFloor = null;

export function getCompFloorUsd() {
  if (cachedFloor !== null) return cachedFloor;
  const ctx = parseYaml(readFileSync(USER_CONTEXT_PATH, "utf8"));
  const floor = ctx?.compensation?.floor_usd;
  if (typeof floor !== "number") {
    throw new Error(
      `config/user-context.yaml: compensation.floor_usd must be a number, got ${typeof floor}`,
    );
  }
  cachedFloor = floor;
  return floor;
}

export function formatCompFloorString(floorUsd) {
  const k = floorUsd / 1000;
  return `$${k}K`;
}
