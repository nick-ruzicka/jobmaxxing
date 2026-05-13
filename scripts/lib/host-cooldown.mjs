/**
 * host-cooldown.mjs — per-host backoff when a WAF starts returning 403s.
 *
 * Background: BuiltIn's edge starts returning HTTP 403 after ~100-110 rapid
 * requests at concurrency=1. Backfill is idempotent (already-recovered rows
 * have comp_source set and shouldBackfill returns false), so the goal of
 * this module is purely "don't keep hammering a host that just blocked us".
 *
 * Trigger: K consecutive 403 responses from the same host, with the entire
 * streak fitting inside a sliding `windowMs` window. K and windowMs are
 * configurable; defaults are 5 and 60s respectively. On trigger, the host's
 * `cooldownUntil` advances by `cooldownMs`. Non-403 responses clear the
 * streak.
 *
 * The tracker is pure logic — no timers, no global state. Callers pass `now`
 * (so tests can simulate time) and are responsible for actually sleeping
 * with `await sleepUntil(tracker.cooldownUntil(host))`.
 *
 * Test coverage: scripts/lib/host-cooldown.test.mjs
 */

const DEFAULTS = {
  cooldownMs: 90_000,
  windowMs: 60_000,
  threshold: 5,
};

export function createCooldownTracker(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (cfg.threshold < 1) throw new Error("threshold must be >= 1");

  /** Map<host, { last403s: number[], cooldownUntil: number }> */
  const hosts = new Map();

  function state(host) {
    let s = hosts.get(host);
    if (!s) {
      s = { last403s: [], cooldownUntil: 0 };
      hosts.set(host, s);
    }
    return s;
  }

  /**
   * record(host, status, now): call after every fetch attempt.
   *
   * Returns { triggered, cooldownUntil }:
   *   - triggered:     true ONLY on the call that crossed the threshold,
   *                    so callers can log "cooldown started" exactly once.
   *   - cooldownUntil: epoch-ms the host is paused until (0 if not paused).
   */
  function record(host, status, now) {
    const s = state(host);

    if (status === 403) {
      // Rolling queue of the last `threshold` 403 timestamps. Once it's full
      // and the span fits inside the window, we trigger. After triggering we
      // clear the queue so the next streak counts cleanly (otherwise a 6th
      // 403 in the same burst would re-trigger immediately).
      s.last403s.push(now);
      if (s.last403s.length > cfg.threshold) s.last403s.shift();

      const full = s.last403s.length === cfg.threshold;
      const span = full ? now - s.last403s[0] : Infinity;
      const notAlreadyCoolingDown = s.cooldownUntil <= now;

      if (full && span <= cfg.windowMs && notAlreadyCoolingDown) {
        s.cooldownUntil = now + cfg.cooldownMs;
        s.last403s = [];
        return { triggered: true, cooldownUntil: s.cooldownUntil };
      }
      return { triggered: false, cooldownUntil: s.cooldownUntil };
    }

    // Any non-403 response (200, 404, 500, undefined network error) breaks the streak.
    if (s.last403s.length > 0) s.last403s = [];
    return { triggered: false, cooldownUntil: s.cooldownUntil };
  }

  function cooldownUntil(host) {
    return hosts.get(host)?.cooldownUntil ?? 0;
  }

  function isInCooldown(host, now) {
    return cooldownUntil(host) > now;
  }

  return { record, cooldownUntil, isInCooldown, _config: cfg };
}

/**
 * sleepUntil(epochMs): resolve once `Date.now() >= epochMs`. No-op if the
 * deadline is already past. Capped at 1 hour as a sanity guard.
 */
export function sleepUntil(epochMs) {
  const delay = Math.min(60 * 60 * 1000, Math.max(0, epochMs - Date.now()));
  if (delay === 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, delay));
}
