import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { buildEvent, validateEvent, EVENT_TYPES, VALID_SOURCES } from "./career-ops-events.mjs";
import { writeEvent, emitEvent } from "./event-writer.mjs";
import { readEvents, byType, byRole, byPattern } from "./event-aggregator.mjs";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "career-ops-events-test-"));
}

// ─── schema ───────────────────────────────────────────────────────────────────

test("events — buildEvent produces required core fields", () => {
  const e = buildEvent({ type: "role.viewed", payload: { role_id: "r1" } });
  assert.ok(e.id);
  assert.ok(e.timestamp);
  assert.equal(e.type, "role.viewed");
  assert.equal(e.source, "system");
  assert.equal(e.payload.role_id, "r1");
  assert.equal(e.role_id, "r1"); // denormalized
});

test("events — denormalizes archetype to top level when in payload", () => {
  const e = buildEvent({
    type: "role.archetype_classified",
    payload: { role_id: "r1", archetype: "gtm-engineering" },
  });
  assert.equal(e.archetype, "gtm-engineering");
  assert.equal(e.role_id, "r1");
});

test("events — rejects unknown type", () => {
  assert.throws(
    () => buildEvent({ type: "role.exploded", payload: { role_id: "r1" } }),
    /unknown event type/,
  );
});

test("events — rejects missing required field", () => {
  assert.throws(
    () => buildEvent({ type: "role.viewed", payload: {} }),
    /missing required payload field/,
  );
});

test("events — rejects invalid source", () => {
  assert.throws(
    () => buildEvent({ type: "role.viewed", payload: { role_id: "r1" }, source: "anonymous" }),
    /invalid source/,
  );
});

test("events — has at least 20 event types", () => {
  assert.ok(Object.keys(EVENT_TYPES).length >= 20);
});

test("events — every event type covers the 6 categories", () => {
  const prefixes = new Set(Object.keys(EVENT_TYPES).map((t) => t.split(".")[0]));
  for (const expected of ["role", "score", "resume", "context", "onboarding", "backtest"]) {
    assert.ok(prefixes.has(expected), `missing prefix: ${expected}`);
  }
});

test("events — validateEvent accepts a built event", () => {
  const e = buildEvent({ type: "role.pinned", payload: { role_id: "r1" } });
  assert.equal(validateEvent(e), true);
});

test("events — validateEvent rejects malformed event", () => {
  assert.throws(() => validateEvent({ id: "x", type: "role.pinned" }), /timestamp/);
});

// ─── writer ───────────────────────────────────────────────────────────────────

test("event-writer — writes JSONL with one event per line", () => {
  const dir = freshDir();
  try {
    const e1 = emitEvent({ type: "role.viewed", payload: { role_id: "r1" } }, { dir });
    const e2 = emitEvent({ type: "role.pinned", payload: { role_id: "r1" } }, { dir });
    const events = readEvents({ dir });
    assert.equal(events.length, 2);
    assert.equal(events[0].id, e1.id);
    assert.equal(events[1].id, e2.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("event-writer — creates events directory if missing", () => {
  const dir = freshDir();
  rmSync(dir, { recursive: true, force: true }); // doesn't exist
  try {
    emitEvent({ type: "role.viewed", payload: { role_id: "r1" } }, { dir });
    const events = readEvents({ dir });
    assert.equal(events.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("event-writer — writeEvent rejects unvalidated event", () => {
  const dir = freshDir();
  try {
    assert.throws(() => writeEvent({ type: "role.pinned" }, { dir }), /event.id required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── aggregator ───────────────────────────────────────────────────────────────

test("aggregator — readEvents filters by type", () => {
  const dir = freshDir();
  try {
    emitEvent({ type: "role.viewed", payload: { role_id: "r1" } }, { dir });
    emitEvent({ type: "role.pinned", payload: { role_id: "r1" } }, { dir });
    emitEvent({ type: "role.viewed", payload: { role_id: "r2" } }, { dir });
    const filtered = readEvents({ dir, type: "role.viewed" });
    assert.equal(filtered.length, 2);
    for (const e of filtered) assert.equal(e.type, "role.viewed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregator — readEvents filters by role_id", () => {
  const dir = freshDir();
  try {
    emitEvent({ type: "role.viewed", payload: { role_id: "r1" } }, { dir });
    emitEvent({ type: "role.pinned", payload: { role_id: "r2" } }, { dir });
    emitEvent({ type: "role.viewed", payload: { role_id: "r1" } }, { dir });
    const filtered = readEvents({ dir, role_id: "r1" });
    assert.equal(filtered.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregator — byType counts events per type", () => {
  const dir = freshDir();
  try {
    emitEvent({ type: "role.viewed", payload: { role_id: "r1" } }, { dir });
    emitEvent({ type: "role.viewed", payload: { role_id: "r2" } }, { dir });
    emitEvent({ type: "role.pinned", payload: { role_id: "r1" } }, { dir });
    const counts = byType({ dir });
    assert.equal(counts["role.viewed"], 2);
    assert.equal(counts["role.pinned"], 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregator — byRole returns all events for a single role, ordered", () => {
  const dir = freshDir();
  try {
    emitEvent({ type: "role.viewed", payload: { role_id: "r1" } }, { dir });
    emitEvent({ type: "role.viewed", payload: { role_id: "other" } }, { dir });
    emitEvent({ type: "role.pinned", payload: { role_id: "r1" } }, { dir });
    const events = byRole("r1", { dir });
    assert.equal(events.length, 2);
    for (const e of events) assert.equal(e.role_id, "r1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregator — empty directory returns empty array, not throw", () => {
  const dir = freshDir();
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(readEvents({ dir }), []);
});

test("aggregator — byPattern correlates antecedent + outcome on same role", () => {
  const dir = freshDir();
  try {
    // Pattern: classification of web3-bd → dismissal
    emitEvent(
      { type: "role.archetype_classified", payload: { role_id: "r1", archetype: "web3-bd" } },
      { dir },
    );
    emitEvent({ type: "role.dismissed", payload: { role_id: "r1" } }, { dir });
    emitEvent(
      { type: "role.archetype_classified", payload: { role_id: "r2", archetype: "fde" } },
      { dir },
    );
    emitEvent({ type: "role.pinned", payload: { role_id: "r2" } }, { dir });
    const result = byPattern({
      dir,
      outcomeType: "role.dismissed",
      precedingTypes: ["role.archetype_classified"],
    });
    assert.equal(result.outcome_count, 1);
    assert.equal(result.pattern_counts["role.archetype_classified"], 1);
    assert.equal(result.samples.length, 1);
    assert.equal(result.samples[0].antecedent.archetype, "web3-bd");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregator — byPattern rejects unknown outcome type", () => {
  assert.throws(() => byPattern({ outcomeType: "fake.event" }), /known outcomeType/);
});

// ─── VALID_SOURCES sanity ─────────────────────────────────────────────────────

test("events — VALID_SOURCES exported and includes 'dashboard'", () => {
  assert.ok(VALID_SOURCES.includes("dashboard"));
  assert.ok(VALID_SOURCES.includes("cli"));
});
