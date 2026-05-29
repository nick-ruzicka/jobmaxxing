/**
 * Tests for scripts/lib/progress.mjs.
 *
 * Run: node scripts/lib/progress.test.mjs
 *
 * Strategy: spawn a child node process with / without the flag, capture
 * stdout, assert the JSONL events fire when expected and silently no-op
 * when not. Spawning is cheaper than mocking process.argv / process.stdout
 * and exercises the real argv flag path the API route relies on.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HARNESS_SCRIPT = `
import { createProgress, isProgressMode } from "${join(__dirname, "progress.mjs")}";

const progress = createProgress({ kind: "harness" });

// Should print to stderr when in JSON mode; stdout when not. Either way the
// test below filters by stream.
console.log("human:hello");

// process.stdout.write also needs to reroute so enrich-style inline output
// (e.g. "[42/763] some-title... ok\\n") doesn't corrupt the JSONL stream.
process.stdout.write("stdout-write:no-newline");
process.stdout.write(" continued\\n");

progress.start({ total: 3, meta: { src: "test" } });
progress.phase("phaseA", "started", { total: 3 });
progress.tick(1, 3, "one");
progress.tick(2, 3, "two");
progress.tick(3, 3, "three");
progress.phase("phaseA", "finished");
progress.warn("a warning");
progress.done({ ok: true, summary: "all ok", meta: { count: 3 } });

console.log("flag is " + isProgressMode());
`;

function runHarness(args) {
  // `--` separates node flags from script flags. Without it, node tries to
  // parse `--progress-json` as one of its own options and exits 9.
  return spawnSync("node", ["--input-type=module", "-e", HARNESS_SCRIPT, "--", ...args], {
    encoding: "utf-8",
  });
}

function parseStdoutJsonl(out) {
  return out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { __nonjson: l };
      }
    });
}

// ─── Test 1: no flag → no JSONL on stdout, human logs flow normally ────────
{
  const result = runHarness([]);
  assert.equal(result.status, 0, `harness exited non-zero: ${result.stderr}`);
  // Default mode: console.log + process.stdout.write both go to stdout;
  // progress emits nothing.
  assert.ok(result.stdout.includes("human:hello"), "human log should appear on stdout in default mode");
  assert.ok(result.stdout.includes("stdout-write:no-newline continued"), "process.stdout.write should land on stdout in default mode");
  assert.ok(result.stdout.includes("flag is false"), "isProgressMode should report false");
  // No JSONL events on stdout.
  const events = parseStdoutJsonl(result.stdout).filter((e) => !e.__nonjson && e.type);
  assert.equal(events.length, 0, `expected 0 events in default mode, got ${events.length}: ${JSON.stringify(events)}`);
  console.log("✓ default mode: no JSONL on stdout, console.log + process.stdout.write appear");
}

// ─── Test 2: --progress-json → stdout is pure JSONL; logs reroute to stderr ─
{
  const result = runHarness(["--progress-json"]);
  assert.equal(result.status, 0, `harness exited non-zero: ${result.stderr}`);
  // console.log was rerouted to console.error, so human:hello shows up in stderr.
  assert.ok(result.stderr.includes("human:hello"), "human log should reroute to stderr in JSON mode");
  // process.stdout.write was also rerouted; inline output lands on stderr.
  assert.ok(result.stderr.includes("stdout-write:no-newline continued"), "process.stdout.write should reroute to stderr in JSON mode");
  // stdout should be PURE JSONL — every non-empty line parses as JSON.
  const parsed = parseStdoutJsonl(result.stdout);
  for (const ev of parsed) {
    assert.ok(!ev.__nonjson, `stdout had non-JSON line: ${ev.__nonjson}`);
  }
  const events = parsed.filter((e) => e.type);
  // Expected: start, phase-started, 3x progress, phase-finished, warn, done = 8 events.
  assert.equal(events.length, 8, `expected 8 events, got ${events.length}: ${JSON.stringify(events, null, 2)}`);
  // Spot-check shape.
  const start = events[0];
  assert.equal(start.type, "start");
  assert.equal(start.kind, "harness");
  assert.equal(start.total, 3);
  assert.equal(start.meta?.src, "test");
  assert.ok(start.ts, "ts must be set");

  const phaseStart = events[1];
  assert.equal(phaseStart.type, "phase");
  assert.equal(phaseStart.name, "phaseA");
  assert.equal(phaseStart.status, "started");

  const firstTick = events[2];
  assert.equal(firstTick.type, "progress");
  assert.equal(firstTick.index, 1);
  assert.equal(firstTick.total, 3);
  assert.equal(firstTick.label, "one");

  const phaseEnd = events[5];
  assert.equal(phaseEnd.type, "phase");
  assert.equal(phaseEnd.status, "finished");

  const warn = events[6];
  assert.equal(warn.type, "warn");
  assert.equal(warn.message, "a warning");

  const done = events[7];
  assert.equal(done.type, "done");
  assert.equal(done.ok, true);
  assert.equal(done.summary, "all ok");
  assert.equal(typeof done.duration_ms, "number");
  assert.ok(done.duration_ms >= 0, "duration_ms must be non-negative");
  assert.equal(done.meta?.count, 3);

  console.log("✓ --progress-json: stdout is pure JSONL, console.log rerouted to stderr");
}

console.log("\nAll tests passed.");
