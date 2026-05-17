// company-aggregator.mjs — per-company aggregation over existing data.
//
// Implements the audit's recommendation #3: surface the per-role enrichment
// payload (verdict, flags, team_context, company_stage, build_component,
// ai_signal) at the company level, not just per role.
//
// Public API:
//   aggregateCompany(slug, opts?)         → aggregate | null
//   aggregateAllCompanies(opts?)          → Map<slug, aggregate>
//
// `opts` can inject `{ seenUrls, enrichments, signals, watchlist }` for tests
// or to feed pre-loaded data; missing keys fall back to disk reads relative
// to the repo root.
//
// Pure-ish: deterministic given inputs. Disk reads only happen when opts
// fields are absent. No writes.

import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { companyKey } from "./normalize-company.mjs";
import { classifyVelocity } from "./company-archetype-matcher.mjs";
import { readCompaniesFile } from "./companies-load.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const PRIMARY_ARCHETYPES = new Set(["gtm-engineering", "ai-operations", "fde"]);

// ISSUE-002: seen-urls often stores the bare company name ("Mistral") while
// signals/UI use the canonical-with-suffix form ("mistralai"). Without fuzzy
// candidate lookup, aggregateCompany("mistralai") finds nothing in
// byCompany even though the role exists. These suffixes match
// scripts/lib/company-archetype-matcher.mjs's COMPANY_SUFFIXES and
// dashboard-web/lib/role-matching.ts's FUZZY_SUFFIXES — change all three
// together.
const FUZZY_SUFFIXES = ["ai", "labs", "tech", "io", "hq", "app", "xyz"];

function aggregatorCandidateKeys(slug) {
  const primary = companyKey(slug) || String(slug).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!primary) return [];
  const out = [primary];
  for (const suffix of FUZZY_SUFFIXES) {
    if (primary.endsWith(suffix) && primary.length > suffix.length + 2) {
      const stripped = primary.slice(0, -suffix.length);
      if (!out.includes(stripped)) out.push(stripped);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Disk loaders (only called when opts doesn't provide the data)
// ---------------------------------------------------------------------------

function readJsonSafe(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function loadSeenUrls() {
  return readJsonSafe(join(REPO_ROOT, "data", "seen-urls.json"), {});
}

function loadEnrichments() {
  return readJsonSafe(join(REPO_ROOT, "data", "enrichments.json"), {});
}

function loadSignals() {
  const raw = readJsonSafe(join(REPO_ROOT, "data", "signal-seen.json"), {});
  return Object.entries(raw).map(([slug, data]) => ({
    slug,
    name: data.name,
    amount: data.amount,
    lastChecked: data.lastChecked,
    result: data.result,
  }));
}

function loadWatchlist() {
  // readCompaniesFile returns { entries, path } — unwrap to the entries array
  // the aggregator expects. Returning the wrapper object directly caused a
  // "watchlist is not iterable" TypeError at runtime.
  try {
    const { entries } = readCompaniesFile();
    return entries;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Bucket entries by a key derived from each one, return Map<key, count>.
 */
function countBy(entries, keyFn) {
  const m = new Map();
  for (const e of entries) {
    const k = keyFn(e);
    if (k === undefined || k === null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/**
 * Convert a Map<key, count> into a sorted array of {key, count} objects, with
 * the given field name in place of `key`. Stable secondary sort by the key's
 * string form so ties resolve deterministically.
 */
function toSorted(map, fieldName, limit = Infinity) {
  const arr = [...map.entries()].map(([k, count]) => ({ [fieldName]: k, count }));
  arr.sort((a, b) => b.count - a.count || String(a[fieldName]).localeCompare(String(b[fieldName])));
  return arr.slice(0, limit);
}

/**
 * Group seenUrls by company key. Yields Map<key, { name, urls: string[] }>.
 * The display name comes from the first non-empty `company` field we see —
 * good enough for the aggregator (we hand display rendering off to the page).
 */
function groupSeenByCompany(seenUrls) {
  const out = new Map();
  for (const [url, row] of Object.entries(seenUrls)) {
    if (!row || !row.company) continue;
    const ck = companyKey(row.company);
    if (!ck) continue;
    if (!out.has(ck)) out.set(ck, { name: row.company, urls: [] });
    out.get(ck).urls.push(url);
  }
  return out;
}

/**
 * Index signals by their slug-as-key. Signals already arrive with a slug that
 * matches our companyKey convention (lowercase alphanumeric), so no transform
 * needed — but we still pipe through companyKey to be defensive about input.
 */
function indexSignals(signals) {
  const out = new Map();
  for (const s of signals) {
    if (!s || !s.slug) continue;
    const ck = companyKey(s.slug) || s.slug.toLowerCase().replace(/[^a-z0-9]/g, "");
    out.set(ck, s);
  }
  return out;
}

/**
 * Index watchlist entries by their canonical_name's companyKey form. The
 * companies.yml `slug` field is ATS-shaped (kebab-case) and doesn't match
 * the dashboard's companyKey form — we always re-derive from canonical_name.
 */
function indexWatchlist(watchlist) {
  const out = new Map();
  for (const w of watchlist) {
    if (!w || !w.canonical_name) continue;
    out.set(companyKey(w.canonical_name), w);
  }
  return out;
}

/**
 * Build a stable per-role id from its URL. Mirrors dashboard-web/lib/data.ts's
 * approach so a role id is comparable across surfaces.
 */
function roleIdFromUrl(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Core: build an aggregate for one company
// ---------------------------------------------------------------------------

function buildAggregate({
  slug,
  identityName,
  urls,
  enrichments,
  seenUrls,
  signal,
  watchEntry,
}) {
  // Roles -----------------------------------------------------------------
  const roles = urls.map((url) => {
    const seen = seenUrls[url] || {};
    const e = enrichments[url] || {};
    const hasEnrichment = e && !e.error;
    return {
      id: roleIdFromUrl(url),
      title: seen.title || "(no title)",
      archetype_primary: hasEnrichment ? (e.archetype_primary ?? null) : null,
      score_adjusted: hasEnrichment && typeof e.score_adjusted === "number" ? e.score_adjusted : null,
      score_base: hasEnrichment && typeof e.score_base === "number" ? e.score_base : null,
      link: url,
      firstSeen: seen.firstSeen || "",
    };
  });

  // Enrichment summary ----------------------------------------------------
  const enrichedRows = urls
    .map((url) => enrichments[url])
    .filter((e) => e && !e.error);

  // Flags — flatten each row's array, count by exact-string match.
  const greenFlagsMap = new Map();
  const redFlagsMap = new Map();
  const teamContextMap = new Map();
  const stageMap = new Map();
  const buildCompMap = new Map();
  const aiSignalMap = new Map();
  const archetypeDist = {};

  for (const e of enrichedRows) {
    for (const f of e.green_flags || []) {
      if (typeof f !== "string") continue;
      greenFlagsMap.set(f, (greenFlagsMap.get(f) || 0) + 1);
    }
    for (const f of e.red_flags || []) {
      if (typeof f !== "string") continue;
      redFlagsMap.set(f, (redFlagsMap.get(f) || 0) + 1);
    }
    if (typeof e.team_context === "string" && e.team_context.trim()) {
      const t = e.team_context.trim();
      teamContextMap.set(t, (teamContextMap.get(t) || 0) + 1);
    }
    if (typeof e.company_stage === "string" && e.company_stage.trim()) {
      const s = e.company_stage.trim();
      stageMap.set(s, (stageMap.get(s) || 0) + 1);
    }
    if (typeof e.build_component === "boolean") {
      buildCompMap.set(e.build_component, (buildCompMap.get(e.build_component) || 0) + 1);
    }
    if (typeof e.ai_signal === "boolean") {
      aiSignalMap.set(e.ai_signal, (aiSignalMap.get(e.ai_signal) || 0) + 1);
    }
    if (typeof e.archetype_primary === "string") {
      archetypeDist[e.archetype_primary] = (archetypeDist[e.archetype_primary] || 0) + 1;
    }
  }

  // company_stage: mode (most frequent value). Null when no enrichment had it.
  let stageMode = null;
  if (stageMap.size > 0) {
    const sorted = [...stageMap.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    stageMode = { mode: sorted[0][0], count: sorted[0][1] };
  }

  const enrichmentSummary = {
    green_flags: toSorted(greenFlagsMap, "flag", 5),
    red_flags: toSorted(redFlagsMap, "flag", 5),
    team_context: toSorted(teamContextMap, "theme"),
    company_stage: stageMode,
    build_component: toSorted(buildCompMap, "value"),
    ai_signal: toSorted(aiSignalMap, "value"),
  };

  // Last role seen --------------------------------------------------------
  let lastRoleSeenDate = null;
  for (const r of roles) {
    if (r.firstSeen && (lastRoleSeenDate === null || r.firstSeen > lastRoleSeenDate)) {
      lastRoleSeenDate = r.firstSeen;
    }
  }

  // Hiring velocity --------------------------------------------------------
  // Count archetype-matched roles (primary archetypes only — matches the
  // existing /signals matcher) and feed classifyVelocity.
  const primaryArchetypeRoles = enrichedRows.filter(
    (e) => typeof e.archetype_primary === "string" && PRIMARY_ARCHETYPES.has(e.archetype_primary)
  ).length;
  const hiringVelocity = classifyVelocity(primaryArchetypeRoles);

  // Identity ---------------------------------------------------------------
  // Prefer the signal's name (it's the most "canonical" — the user has seen it
  // in funding feeds) → fall back to whatever seenUrls said.
  const identity = {
    name: signal?.name || identityName,
    slug,
    funding_amount: signal?.amount ?? null,
    funding_date: signal?.lastChecked ?? null,
    ats: watchEntry?.ats ?? null,
    employee_count: null,
  };

  return {
    identity,
    roles,
    hiring_velocity: hiringVelocity,
    enrichment_summary: enrichmentSummary,
    archetype_distribution: archetypeDist,
    last_role_seen_date: lastRoleSeenDate,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Aggregate everything we know about one company.
 *
 * @param {string} slug — companyKey form (lowercase alphanumeric)
 * @param {object} [opts] — { seenUrls, enrichments, signals, watchlist }
 * @returns {object|null} aggregate, or null if the slug is unknown.
 */
export function aggregateCompany(slug, opts = {}) {
  const seenUrls = opts.seenUrls ?? loadSeenUrls();
  const enrichments = opts.enrichments ?? loadEnrichments();
  const signals = opts.signals ?? loadSignals();
  const watchlist = opts.watchlist ?? loadWatchlist();

  const byCompany = groupSeenByCompany(seenUrls);
  const signalsIdx = indexSignals(signals);
  const watchIdx = indexWatchlist(watchlist);

  // Fuzzy candidate-key lookup so the drilldown finds roles even when
  // seen-urls stores the bare name ("Mistral", key "mistral") and the slug
  // is the canonical-with-suffix form ("mistralai"). Without this we miss
  // the role group and the drilldown reports roles:[] while /signals says
  // "1 open role" — the QA-confirmed ISSUE-002 repro.
  const candidates = aggregatorCandidateKeys(slug);
  let seenEntry = null;
  for (const k of candidates) {
    const hit = byCompany.get(k);
    if (hit) { seenEntry = hit; break; }
  }
  let signal = null;
  for (const k of candidates) {
    const hit = signalsIdx.get(k);
    if (hit) { signal = hit; break; }
  }
  let watchEntry = null;
  for (const k of candidates) {
    const hit = watchIdx.get(k);
    if (hit) { watchEntry = hit; break; }
  }

  // Unknown slug — not in roles, not in signals.
  if (!seenEntry && !signal) return null;

  return buildAggregate({
    slug,
    identityName: seenEntry?.name ?? signal?.name ?? slug,
    urls: seenEntry?.urls ?? [],
    enrichments,
    seenUrls,
    signal,
    watchEntry,
  });
}

/**
 * Aggregate every known company (union of roles ∪ signals).
 *
 * @param {object} [opts]
 * @returns {Map<string, object>} slug → aggregate
 */
export function aggregateAllCompanies(opts = {}) {
  const seenUrls = opts.seenUrls ?? loadSeenUrls();
  const enrichments = opts.enrichments ?? loadEnrichments();
  const signals = opts.signals ?? loadSignals();
  const watchlist = opts.watchlist ?? loadWatchlist();

  const byCompany = groupSeenByCompany(seenUrls);
  const signalsIdx = indexSignals(signals);
  const watchIdx = indexWatchlist(watchlist);

  const slugs = new Set([...byCompany.keys(), ...signalsIdx.keys()]);
  const out = new Map();
  for (const slug of slugs) {
    const seenEntry = byCompany.get(slug);
    const signal = signalsIdx.get(slug) || null;
    const watchEntry = watchIdx.get(slug) || null;
    out.set(
      slug,
      buildAggregate({
        slug,
        identityName: seenEntry?.name ?? signal?.name ?? slug,
        urls: seenEntry?.urls ?? [],
        enrichments,
        seenUrls,
        signal,
        watchEntry,
      })
    );
  }
  return out;
}
