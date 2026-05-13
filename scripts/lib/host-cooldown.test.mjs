import { test } from "node:test";
import assert from "node:assert/strict";
import { createCooldownTracker, sleepUntil } from "./host-cooldown.mjs";

test("4 consecutive 403s within window do NOT trigger cooldown", () => {
  const t = createCooldownTracker({ cooldownMs: 90_000, windowMs: 60_000, threshold: 5 });
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) {
    const r = t.record("builtin.com", 403, t0 + i * 1000);
    assert.equal(r.triggered, false, `403 #${i + 1} should not trigger`);
    assert.equal(r.cooldownUntil, 0);
  }
});

test("5 consecutive 403s within window trigger cooldown exactly once", () => {
  const t = createCooldownTracker({ cooldownMs: 90_000, windowMs: 60_000, threshold: 5 });
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) t.record("builtin.com", 403, t0 + i * 1000);
  const fifth = t.record("builtin.com", 403, t0 + 4000);
  assert.equal(fifth.triggered, true, "5th 403 should trigger");
  assert.equal(fifth.cooldownUntil, t0 + 4000 + 90_000);

  // A 6th 403 inside the same burst must not re-trigger or extend the cooldown.
  const sixth = t.record("builtin.com", 403, t0 + 5000);
  assert.equal(sixth.triggered, false, "6th 403 in burst should not re-trigger");
  assert.equal(sixth.cooldownUntil, t0 + 4000 + 90_000, "cooldown deadline should not move");
});

test("5 403s spread beyond windowMs do NOT trigger", () => {
  const t = createCooldownTracker({ cooldownMs: 90_000, windowMs: 60_000, threshold: 5 });
  const t0 = 1_000_000;
  // 403s at 0s, 20s, 40s, 60s, 80s — span 80s > window 60s
  const stamps = [0, 20_000, 40_000, 60_000, 80_000];
  let any = false;
  for (const dt of stamps) {
    const r = t.record("builtin.com", 403, t0 + dt);
    if (r.triggered) any = true;
  }
  assert.equal(any, false, "spread-out 403s should not trigger cooldown");
});

test("non-403 response clears the streak (consecutive requirement)", () => {
  const t = createCooldownTracker({ cooldownMs: 90_000, windowMs: 60_000, threshold: 5 });
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) t.record("builtin.com", 403, t0 + i * 1000);
  // A 200 comes back — streak resets.
  const ok = t.record("builtin.com", 200, t0 + 5000);
  assert.equal(ok.triggered, false);
  // 4 more 403s after the reset should still NOT trigger (only 4 since reset).
  for (let i = 0; i < 4; i++) {
    const r = t.record("builtin.com", 403, t0 + 6000 + i * 1000);
    assert.equal(r.triggered, false, `403 #${i + 1} after reset should not trigger`);
  }
  // The 5th after the reset triggers.
  const fifth = t.record("builtin.com", 403, t0 + 10_000);
  assert.equal(fifth.triggered, true);
});

test("per-host isolation: 5 403s on host A do not affect host B", () => {
  const t = createCooldownTracker({ cooldownMs: 90_000, windowMs: 60_000, threshold: 5 });
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) t.record("builtin.com", 403, t0 + i * 1000);
  assert.ok(t.isInCooldown("builtin.com", t0 + 6000), "builtin should be cooling down");
  assert.equal(t.isInCooldown("jobs.ashbyhq.com", t0 + 6000), false, "ashby must NOT be cooling down");
  assert.equal(t.cooldownUntil("jobs.ashbyhq.com"), 0);
});

test("after cooldown expires, a fresh burst of 5 403s re-triggers", () => {
  const t = createCooldownTracker({ cooldownMs: 1000, windowMs: 60_000, threshold: 5 });
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) t.record("builtin.com", 403, t0 + i * 100);
  const firstCooldown = t.cooldownUntil("builtin.com");
  assert.ok(firstCooldown > 0);

  // Time passes well beyond cooldown end.
  const t1 = firstCooldown + 10_000;
  assert.equal(t.isInCooldown("builtin.com", t1), false, "cooldown should have expired");

  // Fresh burst from post-expiry baseline.
  for (let i = 0; i < 4; i++) t.record("builtin.com", 403, t1 + i * 100);
  const fifth = t.record("builtin.com", 403, t1 + 400);
  assert.equal(fifth.triggered, true, "second burst should re-trigger");
  assert.ok(fifth.cooldownUntil > firstCooldown);
});

test("custom threshold (3) and tiny window (1s) wire through", () => {
  const t = createCooldownTracker({ cooldownMs: 5000, windowMs: 1000, threshold: 3 });
  const t0 = 1_000_000;
  t.record("h", 403, t0);
  t.record("h", 403, t0 + 100);
  const third = t.record("h", 403, t0 + 200);
  assert.equal(third.triggered, true);
  assert.equal(third.cooldownUntil, t0 + 200 + 5000);
});

test("threshold of 1 triggers on the first 403 (degenerate but valid)", () => {
  const t = createCooldownTracker({ cooldownMs: 1000, windowMs: 60_000, threshold: 1 });
  const r = t.record("h", 403, 1_000_000);
  assert.equal(r.triggered, true);
});

test("threshold < 1 throws (invalid config)", () => {
  assert.throws(() => createCooldownTracker({ threshold: 0 }), /threshold/);
});

test("simulated fetch sequence: drives tracker through real-feeling traffic", async () => {
  // 'Mock fetch' as a deterministic sequence of (host, status) pairs spaced
  // ~50ms apart. Walks: 50 OKs on builtin, then 5 403s (trigger), then a few
  // OKs on ashby that should be unaffected.
  const t = createCooldownTracker({ cooldownMs: 90_000, windowMs: 60_000, threshold: 5 });

  const seq = [];
  for (let i = 0; i < 50; i++) seq.push(["builtin.com", 200]);
  for (let i = 0; i < 5; i++) seq.push(["builtin.com", 403]);
  for (let i = 0; i < 3; i++) seq.push(["jobs.ashbyhq.com", 200]);

  const now0 = 2_000_000;
  let triggered = null;
  for (let i = 0; i < seq.length; i++) {
    const [host, status] = seq[i];
    const now = now0 + i * 50;
    const r = t.record(host, status, now);
    if (r.triggered && !triggered) triggered = { i, host, until: r.cooldownUntil };
  }

  assert.ok(triggered, "expected a trigger somewhere in the sequence");
  assert.equal(triggered.host, "builtin.com");
  assert.equal(triggered.i, 54, "trigger should land on the 5th 403 (index 54: 50 OK + 5 403, 0-indexed)");
  // The trailing ashby OKs must NOT have been gated by builtin's cooldown.
  assert.equal(t.cooldownUntil("jobs.ashbyhq.com"), 0);
});

test("sleepUntil resolves immediately for past deadlines", async () => {
  const start = Date.now();
  await sleepUntil(Date.now() - 1000);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 50, `expected immediate resolve, took ${elapsed}ms`);
});

test("sleepUntil sleeps approximately the requested duration", async () => {
  const start = Date.now();
  await sleepUntil(Date.now() + 80);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 60, `expected ~80ms sleep, took ${elapsed}ms`);
  assert.ok(elapsed < 500, `expected ~80ms sleep, took ${elapsed}ms (too long)`);
});
