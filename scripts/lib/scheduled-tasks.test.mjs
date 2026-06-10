import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml } from "./yaml-mini.mjs";
import { resolveScheduledTask, KNOWN_SCHEDULED_TASKS } from "./scheduled-tasks.mjs";

test("enabled when explicitly true", () => {
  const ctx = parseYaml("scheduled_tasks:\n  regenerate_briefing: true\n");
  assert.equal(resolveScheduledTask(ctx, "regenerate_briefing"), true);
});

test("disabled when explicitly false", () => {
  const ctx = parseYaml("scheduled_tasks:\n  regenerate_briefing: false\n");
  assert.equal(resolveScheduledTask(ctx, "regenerate_briefing"), false);
});

test("disabled when scheduled_tasks block is absent", () => {
  const ctx = parseYaml("compensation:\n  floor_usd: 200000\n");
  assert.equal(resolveScheduledTask(ctx, "regenerate_briefing"), false);
});

test("disabled when task key is absent from the block", () => {
  const ctx = parseYaml("scheduled_tasks:\n  some_other_task: true\n");
  assert.equal(resolveScheduledTask(ctx, "regenerate_briefing"), false);
});

test("disabled when user context is null (missing/unreadable yaml)", () => {
  assert.equal(resolveScheduledTask(null, "regenerate_briefing"), false);
});

test("disabled for non-boolean truthy values — opt-in must be literal true", () => {
  const ctx = parseYaml('scheduled_tasks:\n  regenerate_briefing: "yes"\n');
  assert.equal(resolveScheduledTask(ctx, "regenerate_briefing"), false);
});

test("KNOWN_SCHEDULED_TASKS includes regenerate_briefing", () => {
  assert.ok(KNOWN_SCHEDULED_TASKS.includes("regenerate_briefing"));
});
