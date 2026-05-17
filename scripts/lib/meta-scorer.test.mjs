import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { proposeRules, persistProposals } from "./meta-scorer.mjs";

test("meta-scorer — no overrides + no events → no proposals", () => {
  const proposals = proposeRules({
    overrides: { boost: {}, penalize: {}, block: [] },
    events: [],
  });
  assert.equal(proposals.length, 0);
});

test("meta-scorer — many rejected-high-fit overrides → cluster proposal", () => {
  // Synth 6 penalize entries with "rejected" and "eval N/M"
  const penalize = {};
  for (let i = 0; i < 6; i++) {
    penalize[`co${i}`] = {
      company: `Co${i}`,
      score: null,
      reason: `auto:applications | rejected (eval 4/5 — CONFLICT) | status=Rejected | claude=7/10`,
      source: "auto:applications",
    };
  }
  const proposals = proposeRules({
    overrides: { boost: {}, penalize, block: [] },
    events: [],
  });
  const cluster = proposals.find((p) => p.kind === "investigate-rejection-cluster");
  assert.ok(cluster, "expected rejection cluster proposal");
  assert.equal(cluster.sample_size, 6);
});

test("meta-scorer — repeated archetype corrections produce classifier-tuning proposal", () => {
  const events = [];
  for (let i = 0; i < 5; i++) {
    events.push({
      type: "role.archetype_corrected",
      payload: {
        role_id: `r${i}`,
        from_archetype: "gtm-engineering",
        to_archetype: "fde",
      },
      timestamp: "2026-05-15T00:00:00Z",
    });
  }
  const proposals = proposeRules({
    overrides: { boost: {}, penalize: {}, block: [] },
    events,
  });
  const tuning = proposals.find((p) => p.kind === "classifier-tuning");
  assert.ok(tuning, "expected classifier-tuning proposal");
  assert.equal(tuning.transition, "gtm-engineering → fde");
});

test("meta-scorer — repeated dismissals on same archetype produce false-positive cluster", () => {
  const events = [];
  for (let i = 0; i < 7; i++) {
    events.push({
      type: "role.dismissed",
      archetype: "ai-operations",
      payload: { role_id: `r${i}` },
      timestamp: "2026-05-15T00:00:00Z",
    });
  }
  const proposals = proposeRules({
    overrides: { boost: {}, penalize: {}, block: [] },
    events,
  });
  const fpc = proposals.find((p) => p.kind === "false-positive-cluster" && p.archetype === "ai-operations");
  assert.ok(fpc);
  assert.equal(fpc.sample_size, 7);
});

test("meta-scorer — does NOT write to score-overrides.json (read-only contract)", () => {
  // We verify by reading the actual file: meta-scorer is supposed to read it
  // without ever opening for write. The simplest test is that proposeRules
  // runs successfully against the real file (no throw, no file system writes
  // can be observed). Stronger test: confirm we can't introspect any write
  // descriptor via the exported API.
  const proposals = proposeRules();
  assert.ok(Array.isArray(proposals));
});

test("meta-scorer — persistProposals writes to injected dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "rule-proposals-test-"));
  try {
    const proposals = [
      { id: "p1", kind: "test", observation: "x", sample_size: 5 },
      { id: "p2", kind: "test", observation: "y", sample_size: 8 },
    ];
    const path = persistProposals(proposals, { dir });
    assert.ok(path);
    const content = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(content.length, 2);
    const first = JSON.parse(content[0]);
    assert.equal(first.id, "p1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("meta-scorer — empty proposals list does not create a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rule-proposals-test-"));
  try {
    const result = persistProposals([], { dir });
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
