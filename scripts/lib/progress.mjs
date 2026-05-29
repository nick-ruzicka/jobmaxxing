/**
 * Progress event emission for long-running scripts (scan-jobs, scan-signals,
 * generate-briefing). Driven by the `--progress-json` CLI flag.
 *
 * Behavior:
 *   - When `--progress-json` is NOT set (default, cron-driven runs): no-op.
 *     Scripts behave exactly as before — human-readable text on stdout.
 *   - When `--progress-json` IS set: scripts emit one JSON line per progress
 *     milestone to stdout. All existing `console.log` calls are re-routed to
 *     stderr so stdout stays pure JSONL for the route's parser.
 *
 * Event schema (each emitted as a single JSON line + `\n`):
 *
 *   { ts, type: "start",    kind, total?, meta? }
 *   { ts, type: "phase",    name, status: "started"|"finished", total?, meta? }
 *   { ts, type: "progress", index, total, label?, meta? }
 *   { ts, type: "warn",     message, meta? }
 *   { ts, type: "done",     ok: bool, summary, duration_ms, meta? }
 *
 * The `summary` field on `done` is the structured text the agent's
 * `tool_result` will surface ("Scanned 47 sources, found 12 new roles"); keep
 * it short and assertion-style.
 *
 * Usage:
 *   import { createProgress } from "./lib/progress.mjs";
 *   const progress = createProgress({ kind: "scan-jobs" });
 *   progress.start({ total: 47, meta: { tier_counts: { 1: 12, 2: 8 } } });
 *   for (const [i, src] of sources.entries()) {
 *     await runSource(src);
 *     progress.tick(i + 1, sources.length, src.name);
 *   }
 *   progress.done({ ok: true, summary: "Scanned 47 sources" });
 *
 * The lib intentionally does not buffer: every event is written
 * synchronously. The parent process (Next.js route) reads stdout line-by-
 * line and forwards each as a `tool_progress` SSE event; back-pressure isn't
 * a concern at the rate these scripts emit (one event per tier or per role).
 */

const FLAG = "--progress-json";

/** Returns true when the script was invoked with `--progress-json`. Caller
 *  scripts can also use this directly to gate additional structured output
 *  (e.g. a structured report path in the `done` summary). */
export function isProgressMode() {
  return process.argv.includes(FLAG);
}

/** Create a Progress emitter for one script run.
 *
 * @param {object} opts
 * @param {string} opts.kind  Short identifier surfaced in events (e.g.
 *   "scan-jobs", "scan-signals", "regenerate-briefing"). Helps the parent
 *   route disambiguate when one route forwards events from multiple kinds.
 * @returns {{
 *   enabled: boolean,
 *   start: (init?: { total?: number, meta?: object }) => void,
 *   phase: (name: string, status: "started"|"finished", extra?: object) => void,
 *   tick: (index: number, total: number, label?: string, meta?: object) => void,
 *   warn: (message: string, meta?: object) => void,
 *   done: (final: { ok: boolean, summary: string, meta?: object }) => void,
 * }}
 */
export function createProgress({ kind }) {
  const enabled = isProgressMode();
  const startTs = Date.now();

  // Save the original stdout.write BEFORE patching anything, because our
  // own progress emissions need to bypass the reroute and land on real
  // stdout. Bind so it carries the correct `this` even if the patch
  // replaces the method.
  const origStdoutWrite = process.stdout.write.bind(process.stdout);

  // When enabled, reroute `console.log` and `process.stdout.write` → stderr
  // so stdout stays pure JSONL for the API route's parser. We patch BOTH
  // because long-running scripts mix `console.log` (briefing-style progress)
  // with `process.stdout.write` (enrich-style inline "[42/763] title…"
  // logging without a newline). Either escape would corrupt the JSONL.
  //
  // console.error / process.stderr.write are untouched — existing warnings
  // and the human-debug output keep flowing to the cron logs / the route's
  // stderr drain.
  if (enabled) {
    const origLog = console.log.bind(console);
    console.log = (...args) => console.error(...args);
    console.log._original = origLog;

    // Re-route process.stdout.write to stderr. Keep the same signature
    // (chunk + optional encoding + optional callback) so callers that rely
    // on the return value or callback don't break.
    process.stdout.write = (chunk, encodingOrCb, maybeCb) => {
      return process.stderr.write(chunk, encodingOrCb, maybeCb);
    };
    process.stdout.write._original = origStdoutWrite;
  }

  function emit(event) {
    if (!enabled) return;
    try {
      // Use the saved original so our emissions reach REAL stdout, not the
      // stderr-rerouted patch installed above.
      origStdoutWrite(JSON.stringify({ ts: new Date().toISOString(), kind, ...event }) + "\n");
    } catch (err) {
      // stdout closed (parent disconnected) — silently swallow; the script
      // should keep running. Detached spawn from the API route uses this
      // path: the parent Next process can exit while the child continues.
    }
  }

  return {
    enabled,
    start(init = {}) {
      emit({ type: "start", total: init.total, meta: init.meta });
    },
    phase(name, status, extra = {}) {
      emit({ type: "phase", name, status, ...extra });
    },
    tick(index, total, label, meta) {
      emit({ type: "progress", index, total, label, meta });
    },
    warn(message, meta) {
      emit({ type: "warn", message, meta });
    },
    done(final) {
      const duration_ms = Date.now() - startTs;
      emit({
        type: "done",
        ok: final.ok,
        summary: final.summary,
        duration_ms,
        meta: final.meta,
      });
    },
  };
}
