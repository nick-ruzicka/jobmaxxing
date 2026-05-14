/**
 * scan-jobs-instrumentation.mjs — wrappers that emit analytics events for the
 * scraper and enricher. INTENTIONALLY DECOUPLED from scan-jobs.mjs / enrich-roles.mjs
 * so it can ship without touching those files.
 *
 * Morning-merge wiring (5–10 line changes):
 *
 * 1. In scripts/scan-jobs.mjs, near the top of main():
 *      import { tierTimer, loggedFetch, recordExaCall, flushEvents } from "./lib/scan-jobs-instrumentation.mjs";
 *
 * 2. Wrap each `[Tier N]` block with `await tierTimer(label, async () => { ... })`
 *    instead of the bare `await scan…()` call. Example:
 *      const ashbyResults = await tierTimer("tier_1_ashby", async () => scanAshby(companies.ashby));
 *
 * 3. Replace top-level `fetch(...)` inside each tier helper with `loggedFetch(url, init, { tier, source })`.
 *    (Keep it minimal — only the outermost fetch per tier, not every per-page fetch.)
 *
 * 4. After each Exa wrapper (`exaSearch`, etc.), call `recordExaCall(body, { query_type, query, duration_ms })`
 *    using the already-fetched response body.
 *
 * 5. In main()'s `finally`, call `await flushEvents()` so buffered events land before exit.
 *
 * For scripts/enrich-roles.mjs:
 *
 * 1. import { recordClaudeCall, recordEnrichmentResult, flushEvents } from "./lib/scan-jobs-instrumentation.mjs";
 *
 * 2. After the Anthropic fetch completes (line ~442) and before parsing:
 *      const claudeBody = await res.json();
 *      recordClaudeCall(claudeBody, { url, model: "claude-sonnet-4-20250514", duration_ms });
 *
 * 3. After enrichment completes (or errors), emit recordEnrichmentResult({...}).
 *
 * Test coverage: scripts/lib/scan-jobs-instrumentation.test.mjs
 */

import { logEvent, flush } from "./event-log.mjs";

// -----------------------------------------------------------------------------
// Pricing — used to convert token usage into USD. Update as Anthropic changes
// list prices (or surface the actual invoice cost via a different signal).
// Per-million-token rates (USD).
// -----------------------------------------------------------------------------

export const CLAUDE_PRICING = {
  // Family-level fallbacks; specific model IDs override.
  default: { input_per_mtok: 3.0, output_per_mtok: 15.0 },
  // Claude 4 family (Opus, Sonnet, Haiku) — prices as of 2026-05.
  // Source: list pricing at the time of writing. Adjust here if rates change.
  "claude-sonnet-4-20250514": { input_per_mtok: 3.0, output_per_mtok: 15.0 },
  "claude-sonnet-4-6": { input_per_mtok: 3.0, output_per_mtok: 15.0 },
  "claude-opus-4-7": { input_per_mtok: 15.0, output_per_mtok: 75.0 },
  "claude-haiku-4-5-20251001": { input_per_mtok: 1.0, output_per_mtok: 5.0 },
};

/**
 * Compute USD cost from token usage and model ID. Returns null if usage is
 * incomplete (we'd rather record nothing than make up a number).
 */
export function computeClaudeCost({ input_tokens, output_tokens, model }) {
  if (typeof input_tokens !== "number" || typeof output_tokens !== "number") {
    return null;
  }
  const rate = CLAUDE_PRICING[model] || CLAUDE_PRICING.default;
  const cost =
    (input_tokens / 1_000_000) * rate.input_per_mtok +
    (output_tokens / 1_000_000) * rate.output_per_mtok;
  // Round to 6 decimal places for stable JSON output.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// -----------------------------------------------------------------------------
// tierTimer — wrap an async tier function with start/complete events.
// -----------------------------------------------------------------------------

/**
 * @param {string} tierLabel — e.g. "tier_1_ashby", "tier_9_builtin"
 * @param {() => Promise<T>} fn — the tier worker; its return value is forwarded
 * @returns {Promise<T>}
 */
export async function tierTimer(tierLabel, fn) {
  const startedAt = Date.now();
  try {
    logEvent({ type: "scrape.tier_start", tier: tierLabel });
  } catch {
    /* swallow */
  }
  let exit_status = "ok";
  let error;
  try {
    const result = await fn();
    return result;
  } catch (err) {
    exit_status = "error";
    error = err?.message || String(err);
    throw err;
  } finally {
    const duration_ms = Date.now() - startedAt;
    try {
      logEvent({
        type: "scrape.tier_complete",
        tier: tierLabel,
        exit_status,
        duration_ms,
        ...(error ? { error } : {}),
      });
    } catch {
      /* swallow */
    }
  }
}

// -----------------------------------------------------------------------------
// loggedFetch — drop-in fetch() replacement that emits http_request / http_error.
// -----------------------------------------------------------------------------

/**
 * @param {string|URL} input
 * @param {RequestInit} [init]
 * @param {object} [meta] — additional context: { tier?, source?, host? }
 * @returns {Promise<Response>}
 */
export async function loggedFetch(input, init = {}, meta = {}) {
  const url = typeof input === "string" ? input : String(input);
  const host = safeHost(url);
  const method = (init.method || "GET").toUpperCase();
  const startedAt = Date.now();
  let status = 0;
  let errorClass;
  try {
    const res = await fetch(input, init);
    status = res.status;
    const duration_ms = Date.now() - startedAt;
    const baseEvent = {
      type: "scrape.http_request",
      host,
      method,
      status,
      duration_ms,
      ...(meta.tier ? { tier: meta.tier } : {}),
      ...(meta.source ? { source: meta.source } : {}),
    };
    try {
      logEvent(baseEvent, { batch: true });
      if (status >= 400) {
        logEvent(
          { ...baseEvent, type: "scrape.http_error", url },
          { batch: true },
        );
      }
    } catch {
      /* swallow */
    }
    return res;
  } catch (err) {
    errorClass = err?.name || "Error";
    const duration_ms = Date.now() - startedAt;
    try {
      logEvent(
        {
          type: "scrape.http_error",
          host,
          method,
          status: 0,
          duration_ms,
          error_class: errorClass,
          error: err?.message || String(err),
          url,
          ...(meta.tier ? { tier: meta.tier } : {}),
          ...(meta.source ? { source: meta.source } : {}),
        },
        { batch: true },
      );
    } catch {
      /* swallow */
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Exa cost capture — call site already has the parsed body.
// -----------------------------------------------------------------------------

/**
 * @param {object} exaBody — the parsed JSON body from an Exa API response
 * @param {object} ctx — { query_type, query, duration_ms?, tier? }
 */
export function recordExaCall(exaBody, ctx = {}) {
  if (!exaBody || typeof exaBody !== "object") return;
  const cost_usd =
    typeof exaBody.costDollars === "number"
      ? exaBody.costDollars
      : typeof exaBody.costDollars === "object" && exaBody.costDollars !== null
        ? sumCostObject(exaBody.costDollars)
        : null;
  const num_results = Array.isArray(exaBody.results) ? exaBody.results.length : 0;
  try {
    logEvent({
      type: "scrape.exa_call",
      query_type: ctx.query_type || "search",
      query: ctx.query,
      num_results,
      cost_usd,
      ...(ctx.duration_ms !== undefined ? { duration_ms: ctx.duration_ms } : {}),
      ...(ctx.tier ? { tier: ctx.tier } : {}),
    });
  } catch {
    /* swallow */
  }
}

function sumCostObject(obj) {
  let s = 0;
  for (const v of Object.values(obj)) {
    if (typeof v === "number") s += v;
    else if (typeof v === "object" && v !== null) s += sumCostObject(v);
  }
  return s;
}

// -----------------------------------------------------------------------------
// Claude usage capture — call site has the Anthropic response body.
// -----------------------------------------------------------------------------

/**
 * @param {object} claudeBody — the parsed JSON body from POST /v1/messages
 * @param {object} ctx — { url?, model, duration_ms?, role_id? }
 */
export function recordClaudeCall(claudeBody, ctx = {}) {
  if (!claudeBody || typeof claudeBody !== "object") return;
  const usage = claudeBody.usage || {};
  const input_tokens =
    typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const output_tokens =
    typeof usage.output_tokens === "number" ? usage.output_tokens : null;
  const model = ctx.model || claudeBody.model || "unknown";
  const cost_usd =
    input_tokens !== null && output_tokens !== null
      ? computeClaudeCost({ input_tokens, output_tokens, model })
      : null;
  try {
    logEvent({
      type: "enrich.claude_call",
      url: ctx.url,
      model,
      input_tokens,
      output_tokens,
      cost_usd,
      ...(ctx.duration_ms !== undefined ? { duration_ms: ctx.duration_ms } : {}),
    });
  } catch {
    /* swallow */
  }
}

// -----------------------------------------------------------------------------
// Enrichment lifecycle — emit start/complete/error.
// -----------------------------------------------------------------------------

export function recordEnrichmentStart({ url, host }) {
  try {
    logEvent({ type: "enrich.start", url, host });
  } catch {
    /* swallow */
  }
}

export function recordEnrichmentResult({ url, host, fit_score, comp_range, status = "ok" }) {
  try {
    logEvent({
      type: status === "error" ? "enrich.error" : "enrich.complete",
      url,
      host,
      ...(typeof fit_score === "number" ? { fit_score } : {}),
      ...(comp_range !== undefined ? { comp_range } : {}),
    });
  } catch {
    /* swallow */
  }
}

export function recordQuarantineSkip({ url, host, reason }) {
  try {
    logEvent({ type: "enrich.skip_quarantined", url, host, reason });
  } catch {
    /* swallow */
  }
}

// -----------------------------------------------------------------------------
// Funnel hooks — dedup, filter rejections, role discoveries.
// -----------------------------------------------------------------------------

export function recordDedupSkip({ url, kind, reason }) {
  try {
    logEvent(
      { type: "scrape.dedup_skip", url, kind, reason },
      { batch: true },
    );
  } catch {
    /* swallow */
  }
}

export function recordFilterReject({ url, title, company, reason }) {
  try {
    logEvent(
      { type: "scrape.filter_reject", url, title, company, reason },
      { batch: true },
    );
  } catch {
    /* swallow */
  }
}

export function recordRoleDiscovered({ url, host, source, tier, title, company }) {
  try {
    logEvent(
      {
        type: "scrape.role_discovered",
        url,
        host,
        source,
        tier,
        title,
        company,
      },
      { batch: true },
    );
  } catch {
    /* swallow */
  }
}

// -----------------------------------------------------------------------------
// Buffer flush — call at tier boundaries and on exit.
// -----------------------------------------------------------------------------

export function flushEvents() {
  try {
    flush();
  } catch {
    /* swallow */
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
