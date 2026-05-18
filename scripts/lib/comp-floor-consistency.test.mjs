// Cross-runtime consistency gate for the comp-floor single source of truth.
// Every site that references comp floor MUST agree with config/user-context.yaml.
// Files asserted here keep their literal values; this test enforces equality.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./yaml-mini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const userContext = parseYaml(readFileSync(path.join(repoRoot, "config/user-context.yaml"), "utf8"));
const FLOOR = userContext.compensation.floor_usd;
const FLOOR_K = `$${FLOOR / 1000}K`;

test("comp-floor consistency — config has a numeric floor_usd", () => {
  assert.equal(typeof FLOOR, "number");
  assert.ok(FLOOR > 0);
});

test("comp-floor consistency — archetypes.yaml has NO global_disqualifiers.comp_below", () => {
  const archetypes = parseYaml(readFileSync(path.join(repoRoot, "config/archetypes.yaml"), "utf8"));
  const gd = archetypes.global_disqualifiers ?? {};
  assert.equal(gd.comp_below, undefined, "comp_below should be removed in favor of user-context floor_usd");
});

test("comp-floor consistency — modes/_profile.md uses floor matching config", () => {
  const body = readFileSync(path.join(repoRoot, "modes/_profile.md"), "utf8");
  assert.ok(body.includes(`${FLOOR_K} total comp`), `expected '${FLOOR_K} total comp' in modes/_profile.md`);
  assert.ok(!body.includes("$190K"), "modes/_profile.md should not contain stale $190K");
});

test("comp-floor consistency — generate-briefing.mjs fallback derives from config", () => {
  const body = readFileSync(path.join(repoRoot, "scripts/generate-briefing.mjs"), "utf8");
  // Accept either: literal FLOOR_K in the file, OR a reference to formatCompFloorString (dynamic build)
  assert.ok(
    body.includes(FLOOR_K) || body.includes("formatCompFloorString"),
    `expected '${FLOOR_K}' or 'formatCompFloorString' in scripts/generate-briefing.mjs`,
  );
});

test("comp-floor consistency — dashboard chat route fallback derives from config", () => {
  const body = readFileSync(path.join(repoRoot, "dashboard-web/app/api/chat/route.ts"), "utf8");
  assert.ok(
    body.includes(FLOOR_K) || body.includes("formatCompFloorString"),
    `expected '${FLOOR_K}' or 'formatCompFloorString' in dashboard-web/app/api/chat/route.ts`,
  );
});

test("comp-floor consistency — autoapply popup salary_floor_usd equals FLOOR", () => {
  const body = readFileSync(path.join(repoRoot, "autoapply/chrome-extension/popup/popup.js"), "utf8");
  const m = body.match(/salary_floor_usd:\s*(\d+)/);
  assert.ok(m, "salary_floor_usd not found in popup.js");
  assert.equal(Number(m[1]), FLOOR);
});

test("comp-floor consistency — autoapply test_apply_cli.py fixture equals FLOOR", () => {
  const body = readFileSync(path.join(repoRoot, "autoapply/tests/test_apply_cli.py"), "utf8");
  const m = body.match(/"salary_floor_usd":\s*(\d+)/);
  assert.ok(m, "salary_floor_usd not found in test_apply_cli.py");
  assert.equal(Number(m[1]), FLOOR);
});

test("comp-floor consistency — personalab valid_persona.yaml equals FLOOR", () => {
  const persona = parseYaml(
    readFileSync(path.join(repoRoot, "personalab/tests/fixtures/valid_persona.yaml"), "utf8"),
  );
  assert.equal(persona.comp_floor, FLOOR);
});

test("comp-floor consistency — personalab test_analyzer.py equals FLOOR", () => {
  const body = readFileSync(path.join(repoRoot, "personalab/tests/test_analyzer.py"), "utf8");
  const m = body.match(/"comp_floor":\s*(\d+)/);
  assert.ok(m, "comp_floor not found in test_analyzer.py");
  assert.equal(Number(m[1]), FLOOR);
});
