// Canonical accessor for the comp floor (compensation.floor_usd) defined in
// config/user-context.yaml. TS sibling of scripts/lib/comp-floor.mjs — reads
// the same YAML, returns the same canonical value, caches per-process.
//
// Used by:
//   - dashboard-web/app/api/chat/route.ts (goal-fallback string)
//
// Cross-runtime sibling: scripts/lib/comp-floor.mjs (Node side). Drift between
// the two is prevented by scripts/lib/comp-floor-consistency.test.mjs.

import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { ROOT } from "./data";

type UserContext = {
  compensation?: {
    floor_usd?: number;
  };
};

let cachedFloor: number | null = null;

export function getCompFloorUsd(): number {
  if (cachedFloor !== null) return cachedFloor;
  const ctx = yaml.load(readFileSync(join(ROOT, "config", "user-context.yaml"), "utf8")) as UserContext;
  const floor = ctx?.compensation?.floor_usd;
  if (typeof floor !== "number") {
    throw new Error(
      `config/user-context.yaml: compensation.floor_usd must be a number, got ${typeof floor}`,
    );
  }
  cachedFloor = floor;
  return floor;
}

export function formatCompFloorString(floorUsd: number): string {
  const k = floorUsd / 1000;
  return `$${k}K`;
}
