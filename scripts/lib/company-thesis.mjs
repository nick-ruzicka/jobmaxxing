// company-thesis.mjs — cached per-company thesis generation.
//
// One Claude call per company. Output is a 2-sentence thesis explaining what
// the company is betting on and why it matters. Cached to disk; regenerated
// when the company has acquired newer roles (last_role_seen_date > cached
// generated_at) or on explicit force.
//
// Public API:
//   buildThesisPrompt(aggregate)              → string
//   parseThesisResponse(text)                 → string (trimmed, fence-stripped)
//   thesisStale(lastRoleDate, cachedAt)       → boolean
//   generateThesis(aggregate, opts)           → { thesis, generated_at, cached, error? }
//
// `claudeCall(prompt)` is always injected. Production callers wire it to
// the real Anthropic API; tests pass a mock. The library itself does no
// network I/O — keeps it cheap to test, easy to mock at the boundary the
// budget guard sits on.

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = resolve(__dirname, "..", "..", "data", "company-theses");

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the prompt sent to Claude. Pure: same aggregate → same prompt.
 *
 * Surfaces the aggregator's strongest signals (funding, stage, top flags,
 * team_context themes) so Claude can write a specific thesis rather than
 * a generic platitude. We pass the JSON-ish shape Claude can parse rather
 * than free-form prose — fewer tokens, less ambiguity.
 */
export function buildThesisPrompt(aggregate) {
  const { identity, enrichment_summary, archetype_distribution, hiring_velocity, last_role_seen_date } = aggregate;

  const greenFlags = (enrichment_summary?.green_flags ?? []).map((f) => `- ${f.flag} (${f.count})`).join("\n") || "- (none)";
  const redFlags = (enrichment_summary?.red_flags ?? []).map((f) => `- ${f.flag} (${f.count})`).join("\n") || "- (none)";
  const teamCtx = (enrichment_summary?.team_context ?? []).map((t) => `- ${t.theme}`).join("\n") || "- (none)";
  const stage = enrichment_summary?.company_stage ? enrichment_summary.company_stage.mode : "(unknown)";
  const archetypes = Object.entries(archetype_distribution ?? {})
    .map(([k, v]) => `${k}:${v}`)
    .join(", ") || "(none)";

  return `You are writing a tight, specific thesis on a company a candidate is tracking for jobs.

Company: ${identity.name}
Funding: ${identity.funding_amount ?? "(unknown)"}
Stage: ${stage}
Hiring velocity: ${hiring_velocity}
Last role seen: ${last_role_seen_date ?? "(none)"}
Open-role archetypes: ${archetypes}

Repeated green flags (across the company's open roles):
${greenFlags}

Repeated red flags:
${redFlags}

Team context themes:
${teamCtx}

Write a 2 sentences (~50 words total) thesis on (a) what this company is betting on, and (b) why it matters for someone tracking GTM-engineering / AI-ops roles. Be specific — name the bet, the market, the leverage. No platitudes ("revolutionizing"/"transforming"/"cutting-edge"). No hedging. Plain prose only — no JSON, no markdown.`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Trim Claude's response and strip common output decorations.
 */
export function parseThesisResponse(text) {
  if (!text) return "";
  let body = String(text).trim();

  // Strip markdown fences if present.
  const fence = body.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  if (fence) body = fence[1].trim();

  // Strip a leading "Thesis:" label if Claude adds one.
  body = body.replace(/^thesis\s*:\s*/i, "").trim();

  return body;
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/**
 * Decide whether the cached thesis is stale. We compare the company's
 * last_role_seen_date (YYYY-MM-DD) with the cached generated_at (ISO ts).
 * If a new role has appeared after the cache was written, regenerate.
 */
export function thesisStale(lastRoleDate, cachedAt) {
  if (!cachedAt) return true;
  if (!lastRoleDate) return false;
  // Both formats compare lexicographically on YYYY-MM-DD prefix.
  const cachedDate = String(cachedAt).slice(0, 10);
  return lastRoleDate > cachedDate;
}

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------

function cacheFilePath(cacheDir, slug) {
  return join(cacheDir, `${slug}.json`);
}

function readCache(cacheDir, slug) {
  const path = cacheFilePath(cacheDir, slug);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(cacheDir, slug, entry) {
  mkdirSync(cacheDir, { recursive: true });
  const target = cacheFilePath(cacheDir, slug);
  const tmp = `${target}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n");
  // Atomic-on-POSIX: rename replaces target in one syscall, so a reader
  // never sees a half-written file.
  renameSync(tmp, target);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Generate or fetch a cached thesis for a company aggregate.
 *
 * @param {object} aggregate — from scripts/lib/company-aggregator.mjs
 * @param {object} opts
 *   - cacheDir: directory holding {slug}.json files (default data/company-theses/)
 *   - claudeCall(prompt): async (prompt) => string — required for cache miss
 *   - now(): () => Date — testable timestamp source
 *   - force: bool — regenerate even when cache fresh
 *   - readOnly: bool — never call Claude; return cached or {thesis:null}
 * @returns {{thesis: string|null, generated_at: string|null, cached: boolean, error?: string}}
 */
export async function generateThesis(aggregate, opts = {}) {
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const now = opts.now ?? (() => new Date());
  const slug = aggregate?.identity?.slug;
  if (!slug) {
    return { thesis: null, generated_at: null, cached: false, error: "missing slug" };
  }

  const cached = readCache(cacheDir, slug);
  const stale = cached ? thesisStale(aggregate.last_role_seen_date, cached.generated_at) : true;

  // Cache hit — fresh, no force: return as-is.
  if (cached && !stale && !opts.force) {
    return {
      thesis: cached.thesis,
      generated_at: cached.generated_at,
      cached: true,
    };
  }

  // readOnly: serve whatever's on disk (even if stale) and never call Claude.
  if (opts.readOnly) {
    if (cached) {
      return {
        thesis: cached.thesis,
        generated_at: cached.generated_at,
        cached: true,
      };
    }
    return { thesis: null, generated_at: null, cached: false };
  }

  // Cache miss / stale / forced — call Claude.
  if (typeof opts.claudeCall !== "function") {
    return {
      thesis: cached?.thesis ?? null,
      generated_at: cached?.generated_at ?? null,
      cached: !!cached,
      error: "claudeCall not provided",
    };
  }

  let text;
  try {
    const prompt = buildThesisPrompt(aggregate);
    const raw = await opts.claudeCall(prompt);
    text = parseThesisResponse(raw);
  } catch (err) {
    return {
      thesis: cached?.thesis ?? null,
      generated_at: cached?.generated_at ?? null,
      cached: !!cached,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const generated_at = now().toISOString();
  const entry = { thesis: text, generated_at };
  writeCache(cacheDir, slug, entry);
  return { thesis: text, generated_at, cached: false };
}
