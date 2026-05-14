import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createEventLogger,
  validateEvent,
  EVENT_TYPES,
} from "./event-log.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "event-log-test-"));
}

function readLines(file) {
  return readFileSync(file, "utf8").trim().split("\n");
}

test("writes a single event as one JSON line to YYYY-MM-DD.jsonl", () => {
  const dir = tmp();
  try {
    const { logEvent } = createEventLogger({ dir });
    logEvent({ type: "scrape.tier_start", tier: "builtin" });
    const today = new Date().toISOString().slice(0, 10);
    const file = join(dir, `${today}.jsonl`);
    assert.ok(existsSync(file), "expected jsonl file to exist");
    const lines = readLines(file);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.type, "scrape.tier_start");
    assert.equal(parsed.tier, "builtin");
    assert.ok(parsed.ts.match(/^\d{4}-\d{2}-\d{2}T/), "ts must be ISO 8601");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("multiple events append (never rewrite)", () => {
  const dir = tmp();
  try {
    const { logEvent } = createEventLogger({ dir });
    for (let i = 0; i < 3; i++) {
      logEvent({ type: "scrape.role_discovered", url: `https://x/${i}` });
    }
    const today = new Date().toISOString().slice(0, 10);
    const lines = readLines(join(dir, `${today}.jsonl`));
    assert.equal(lines.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(JSON.parse(lines[i]).url, `https://x/${i}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("disabled logger is a no-op (no file written)", () => {
  const dir = tmp();
  try {
    const { logEvent, flush } = createEventLogger({ dir, enabled: false });
    logEvent({ type: "scrape.tier_start" });
    logEvent({ type: "scrape.role_discovered", url: "x" }, { batch: true });
    flush();
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(existsSync(join(dir, `${today}.jsonl`)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("batched events only flush on threshold or explicit flush()", () => {
  const dir = tmp();
  try {
    const { logEvent, flush, getBuffer } = createEventLogger({ dir, bufferMax: 5 });
    for (let i = 0; i < 4; i++) {
      logEvent({ type: "scrape.http_request", host: "x" }, { batch: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    const file = join(dir, `${today}.jsonl`);
    assert.equal(existsSync(file), false, "should not have written yet");
    assert.equal(getBuffer().length, 4);

    // 5th event hits threshold → auto-flushes
    logEvent({ type: "scrape.http_request", host: "x" }, { batch: true });
    assert.ok(existsSync(file), "auto-flush at threshold should have written");
    assert.equal(readLines(file).length, 5);
    assert.equal(getBuffer().length, 0);

    // More batched events; explicit flush
    logEvent({ type: "scrape.http_request", host: "x" }, { batch: true });
    logEvent({ type: "scrape.http_request", host: "x" }, { batch: true });
    assert.equal(getBuffer().length, 2);
    flush();
    assert.equal(getBuffer().length, 0);
    assert.equal(readLines(file).length, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateEvent throws on unknown type with a helpful message", () => {
  assert.throws(
    () => validateEvent({ type: "bogus.unknown" }),
    /unknown event type "bogus\.unknown"/,
  );
});

test("validateEvent throws on missing type / wrong shape", () => {
  assert.throws(() => validateEvent(null), /must be a plain object/);
  assert.throws(() => validateEvent("nope"), /must be a plain object/);
  assert.throws(() => validateEvent([]), /must be a plain object/);
  assert.throws(() => validateEvent({}), /event\.type must be a string/);
  assert.throws(() => validateEvent({ type: 123 }), /event\.type must be a string/);
});

test("validateEvent throws on bad ts", () => {
  assert.throws(
    () => validateEvent({ type: "scrape.tier_start", ts: "not-a-date" }),
    /not a valid ISO 8601 timestamp/,
  );
  assert.throws(
    () => validateEvent({ type: "scrape.tier_start", ts: 12345 }),
    /must be an ISO 8601 string/,
  );
});

test("validateEvent injects ts when not provided", () => {
  const e = validateEvent({ type: "scrape.tier_start" });
  assert.ok(e.ts);
  assert.ok(Date.parse(e.ts) > 0);
});

test("validateEvent preserves ts when provided", () => {
  const ts = "2026-05-14T08:00:00.123Z";
  const e = validateEvent({ type: "scrape.tier_start", ts });
  assert.equal(e.ts, ts);
});

test("validateEvent rejects un-serializable payloads", () => {
  const circular = { type: "scrape.tier_start" };
  circular.self = circular;
  assert.throws(() => validateEvent(circular), /not JSON-serializable/);
});

test("logEvent rejects unknown types via createEventLogger too", () => {
  const dir = tmp();
  try {
    const { logEvent } = createEventLogger({ dir });
    assert.throws(
      () => logEvent({ type: "definitely.not.real" }),
      /unknown event type/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daily rotation: events explicitly tagged with different dates write to different files", () => {
  const dir = tmp();
  try {
    const { logEvent, flush } = createEventLogger({ dir });
    logEvent({ type: "scrape.tier_start", ts: "2026-05-13T23:59:59.999Z" }, { batch: true });
    logEvent({ type: "scrape.tier_start", ts: "2026-05-14T00:00:00.000Z" }, { batch: true });
    flush();
    const day1 = join(dir, "2026-05-13.jsonl");
    const day2 = join(dir, "2026-05-14.jsonl");
    assert.ok(existsSync(day1), "day 1 file should exist");
    assert.ok(existsSync(day2), "day 2 file should exist");
    assert.equal(readLines(day1).length, 1);
    assert.equal(readLines(day2).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createEventLogger requires dir when enabled", () => {
  assert.throws(() => createEventLogger({ enabled: true }), /`dir` is required/);
});

test("EVENT_TYPES covers the full taxonomy from the audit", () => {
  // The audit doc enumerates these — keep test as a tripwire when new types are added.
  const expected = [
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
  ];
  for (const t of expected) {
    assert.ok(EVENT_TYPES.has(t), `missing taxonomy entry: ${t}`);
  }
});

test("flush() on empty buffer is a no-op", () => {
  const dir = tmp();
  try {
    const { flush } = createEventLogger({ dir });
    flush();
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(existsSync(join(dir, `${today}.jsonl`)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
