// Canonical accessor for the comp floor (compensation.floor_usd) defined in
// config/user-context.yaml. Mirrors the pattern used by scoring-layer.mjs's
// loadUserContext() — parses the YAML via yaml-mini.mjs, caches per-process.
//
// Used by:
//   - scripts/generate-briefing.mjs    (goal-fallback string)
//   - scripts/lib/comp-floor-consistency.test.mjs (drift gate)
//
// Cross-runtime sibling: dashboard-web/lib/comp-floor.ts (reads the same YAML).

import { parseYaml } from "./yaml-mini.mjs";
import { readUserContextText } from "./user-context-file.mjs";

let cachedFloor = null;

export function getCompFloorUsd() {
  if (cachedFloor !== null) return cachedFloor;
  const ctx = parseYaml(readUserContextText());
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
