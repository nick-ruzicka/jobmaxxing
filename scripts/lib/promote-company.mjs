/**
 * promote-company.mjs — auto-promote a BuiltIn/YC/etc discovery into a direct ATS
 * tracking entry in config/companies.yml.
 *
 * Trigger condition: an aggregator-discovered role whose apply/canonical URL
 * resolves to a recognized ATS endpoint (jobs.ashbyhq.com/<slug>, …). The slug
 * is appended as a `source: 'auto_promoted_from_<foundVia>'` entry. Next scan run
 * picks it up in Tier 1 and surfaces every role at that company directly.
 *
 * Safety:
 * - Read-then-write under a per-process counter (caller passes a runState with
 *   `promotionsThisRun`); cap at PROMOTION_CAP_PER_RUN to prevent explosions.
 * - Atomic file write via writeCompaniesFile() (temp + rename).
 * - Daily log at data/auto-promotions/YYYY-MM-DD.jsonl for review.
 * - Caller's responsibility to run review-promotions.mjs periodically and decide
 *   whether to confirm / pause / remove each promoted entry.
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  readCompaniesFile,
  writeCompaniesFile,
} from "./companies-load.mjs";
import { hasEntry } from "./companies-schema.mjs";
import {
  extractAtsInfo,
  SUPPORTED_ATS,
} from "./ats-slug-extractor.mjs";
import { classifySource } from "./source-classification.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

/** Maximum auto-promotions in a single scraper run. Safety valve against pathological inputs. */
export const PROMOTION_CAP_PER_RUN = 20;

/**
 * Minimum fit_score for a discovery to qualify for auto-promotion when fit is known.
 * The same floor applies at scan-time (currently bypassed with minFitScore: 0 because
 * fit is unknown pre-enrichment) and at enrich-time (Task A: BuiltIn → ATS hook —
 * fit IS known here, so this floor is what gates junk auto-promotions).
 *
 * Single source of truth: scan-jobs.mjs and enrich-roles.mjs both import this rather
 * than hardcoding a number. Bump here, both call sites pick it up.
 */
export const MIN_FIT_SCORE_FOR_PROMOTION = 4;

/** Hosts that count as "aggregator discoveries" eligible for auto-promotion. */
const PROMOTE_FROM_HOSTS = Object.freeze([
  "builtin.com",
  "builtinboston.com",
  "builtinchicago.org",
  "builtinsf.com",
  // YC: handled by sourceHost matching workatastartup.com OR ycombinator.com
  "workatastartup.com",
  "ycombinator.com",
]);

/** Map a source host to a foundVia label for the auto_promoted_from_<label> tag. */
function foundViaForHost(host) {
  if (!host) return "unknown";
  if (host.includes("builtin")) return "builtin";
  if (host === "workatastartup.com" || host === "ycombinator.com") return "yc";
  return "unknown";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Decide whether a discovery should be auto-promoted.
 *
 * Rules (all must hold):
 *   1. The role URL must look like a known ATS endpoint (extractAtsInfo returns ats+slug).
 *   2. The `sourceHost` (the host of the page that DISCOVERED this URL — i.e., BuiltIn,
 *      YC, etc.) must be in PROMOTE_FROM_HOSTS, AND must not be an aggregator from the
 *      AGGREGATOR_HOSTS quarantine list. We only promote from healthy discovery channels.
 *   3. (ats, slug) must not already be in companies.yml.
 *   4. Optional: minFitScore — if the discovery has a fit score, require it ≥ this (defaults
 *      to 4 — don't promote junk).
 *
 * @param {object} args
 * @param {string} args.url           — the role URL (the one whose ATS slug we want)
 * @param {string} args.sourceHost    — the host of the page that discovered this URL
 *                                       (NOT the same as the URL's host; e.g., a BuiltIn
 *                                       page surfaced a jobs.ashbyhq.com URL)
 * @param {object[]} args.existingCompanies — current companies.yml entries (for dedup)
 * @param {number} [args.fitScore]    — optional fit score (1-9) for the role
 * @param {number} [args.minFitScore] — minimum acceptable fit score (default 4)
 * @returns {{ promote: boolean, reason: string, ats: string | null, slug: string | null }}
 */
export function shouldPromote(args) {
  const {
    url,
    sourceHost,
    existingCompanies = [],
    fitScore,
    minFitScore = MIN_FIT_SCORE_FOR_PROMOTION,
  } = args;

  const { ats, slug } = extractAtsInfo(url);
  if (!ats || !slug) {
    return { promote: false, reason: "url-not-ats", ats: null, slug: null };
  }
  if (!SUPPORTED_ATS.includes(ats)) {
    return { promote: false, reason: "unsupported-ats", ats, slug };
  }

  // sourceHost must be one of our promotion-eligible discovery hosts.
  const sh = (sourceHost || "").toLowerCase().replace(/^www\./, "");
  if (!sh || !PROMOTE_FROM_HOSTS.includes(sh)) {
    return { promote: false, reason: "source-not-promotable", ats, slug };
  }

  // Don't promote from a quarantined aggregator (revopscareers etc.). Defensive — they
  // shouldn't be in PROMOTE_FROM_HOSTS anyway, but check explicitly.
  const cls = classifySource(`https://${sh}/`);
  if (cls.type === "aggregator" || cls.type === "excluded") {
    return { promote: false, reason: "source-quarantined-or-excluded", ats, slug };
  }

  // Dedup against existing entries.
  if (hasEntry(existingCompanies, ats, slug)) {
    return { promote: false, reason: "already-tracked", ats, slug };
  }

  // Quality gate: if fit score is provided, require it ≥ minFitScore.
  if (typeof fitScore === "number" && Number.isFinite(fitScore) && fitScore < minFitScore) {
    return { promote: false, reason: "fit-score-too-low", ats, slug };
  }

  return { promote: true, reason: "ok", ats, slug };
}

/**
 * Append a new entry to companies.yml. Atomic, idempotent (rerun is a no-op if the
 * entry already exists).
 *
 * @param {object} args
 * @param {string} args.ats
 * @param {string} args.slug
 * @param {string} args.canonicalName
 * @param {string} args.sourceUrl    — the URL that triggered the promotion (i.e., the ATS URL)
 * @param {string} args.foundVia     — e.g. "builtin" → source becomes "auto_promoted_from_builtin"
 * @param {string} [args.notes]
 * @param {string} [args.companiesPath]  — override for testing; defaults to repo's companies.yml
 * @param {string} [args.logDir]         — override log dir; defaults to data/auto-promotions
 * @param {string} [args.foundViaUrl]    — the original discovery URL (e.g. the BuiltIn page).
 *                                          For scan-time promotions this is the same as
 *                                          sourceUrl; for enrich-time BuiltIn→ATS promotions
 *                                          this is the BuiltIn URL and sourceUrl is the
 *                                          resolved Ashby/GH/Lever URL.
 * @param {string} [args.resolvedApplyUrl] — the resolved ATS apply URL after JD fetch
 *                                            (enrich-time only; defaults to sourceUrl).
 * @param {number} [args.fitScoreAtPromotion] — fit score snapshot at the moment of promotion
 *                                               (enrich-time only — scan-time doesn't know fit yet).
 * @returns {{ wrote: boolean, entry: object, totalEntries: number }}
 */
export function promoteCompany(args) {
  const {
    ats,
    slug,
    canonicalName,
    sourceUrl,
    foundVia,
    notes,
    companiesPath,
    logDir,
    foundViaUrl,
    resolvedApplyUrl,
    fitScoreAtPromotion,
  } = args;
  if (!ats || !slug || !canonicalName) {
    throw new Error("promoteCompany requires { ats, slug, canonicalName }");
  }
  if (!SUPPORTED_ATS.includes(ats)) {
    throw new Error(`unsupported ats: ${ats}`);
  }

  const { entries, path } = readCompaniesFile(companiesPath);
  if (hasEntry(entries, ats, slug)) {
    return { wrote: false, entry: null, totalEntries: entries.length };
  }

  const today = todayIso();
  const safeFoundVia = (foundVia || "unknown").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  const entry = {
    canonical_name: canonicalName,
    ats,
    slug,
    source: `auto_promoted_from_${safeFoundVia}`,
    added_date: today,
    notes:
      notes ||
      (sourceUrl
        ? `Auto-promoted from ${sourceUrl} on ${today}`
        : `Auto-promoted on ${today}`),
  };
  entries.push(entry);
  writeCompaniesFile(entries, path);

  // Log to data/auto-promotions/YYYY-MM-DD.jsonl (one JSON object per line)
  const dir = logDir || join(ROOT, "data", "auto-promotions");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `${today}.jsonl`);
  appendFileSync(
    logPath,
    JSON.stringify({
      ts: new Date().toISOString(),
      ats,
      slug,
      canonical_name: canonicalName,
      source_url: sourceUrl || null,
      found_via: safeFoundVia,
      // Task A (enrich-time BuiltIn→ATS): capture the discovery URL separately
      // from the resolved ATS URL so reviewers can trace exactly which BuiltIn
      // page surfaced which Ashby slug, and at what fit score.
      found_via_url: foundViaUrl || sourceUrl || null,
      resolved_apply_url: resolvedApplyUrl || sourceUrl || null,
      fit_score_at_promotion:
        typeof fitScoreAtPromotion === "number" && Number.isFinite(fitScoreAtPromotion)
          ? fitScoreAtPromotion
          : null,
    }) + "\n",
  );

  return { wrote: true, entry, totalEntries: entries.length };
}

/**
 * Run-state factory for the per-run promotion cap. The caller (scan-jobs.mjs) creates
 * one of these at the top of a scrape run and passes it to processRolePromotion()
 * for each enriched role. When the cap is hit, further calls log + skip.
 *
 * @returns {{ promotionsThisRun: number, capped: boolean }}
 */
export function createPromotionRunState() {
  return { promotionsThisRun: 0, capped: false };
}

/**
 * High-level convenience: given an enriched role + the source page that surfaced it,
 * decide whether to promote and (if so) do it. Returns one of:
 *   - { action: 'promoted',   entry, reason: 'ok' }
 *   - { action: 'skipped',    reason: '...' }
 *   - { action: 'capped',     reason: 'per-run-cap-reached' }
 *
 * @param {object} args
 * @param {string} args.url           — the URL to promote from (must be ATS-recognized)
 * @param {string} args.sourceHost
 * @param {string} args.canonicalName
 * @param {number} [args.fitScore]
 * @param {object[]} args.existingCompanies
 * @param {ReturnType<typeof createPromotionRunState>} args.runState
 * @param {string} [args.companiesPath]
 * @param {string} [args.logDir]
 * @param {number} [args.minFitScore]
 * @param {number} [args.promotionCap]
 * @param {string} [args.foundViaUrl] — the original discovery URL (different from url
 *                                       when url is a resolved apply_url). Optional;
 *                                       defaults to url. Used purely for log provenance.
 */
export function processRolePromotion(args) {
  const {
    url,
    sourceHost,
    canonicalName,
    fitScore,
    existingCompanies = [],
    runState,
    companiesPath,
    logDir,
    minFitScore,
    promotionCap = PROMOTION_CAP_PER_RUN,
    foundViaUrl,
  } = args;
  if (!runState) throw new Error("processRolePromotion requires runState");

  if (runState.promotionsThisRun >= promotionCap) {
    runState.capped = true;
    return { action: "capped", reason: "per-run-cap-reached" };
  }

  const decision = shouldPromote({
    url,
    sourceHost,
    existingCompanies,
    fitScore,
    minFitScore,
  });
  if (!decision.promote) {
    return { action: "skipped", reason: decision.reason };
  }

  const sh = (sourceHost || "").toLowerCase().replace(/^www\./, "");
  const foundVia = foundViaForHost(sh);
  const result = promoteCompany({
    ats: decision.ats,
    slug: decision.slug,
    canonicalName,
    sourceUrl: url,
    foundVia,
    companiesPath,
    logDir,
    foundViaUrl: foundViaUrl || url,
    resolvedApplyUrl: url,
    fitScoreAtPromotion: fitScore,
  });
  if (result.wrote) {
    runState.promotionsThisRun += 1;
    return { action: "promoted", entry: result.entry, reason: "ok" };
  }
  return { action: "skipped", reason: "race-already-tracked" };
}
