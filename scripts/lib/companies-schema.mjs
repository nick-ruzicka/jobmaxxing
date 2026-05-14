/**
 * companies-schema.mjs — schema validation for config/companies.yml entries.
 *
 * One company-ATS pair per entry. A company can appear multiple times if it's on
 * multiple ATS platforms (e.g., Hebbia on both Ashby and Greenhouse) — that's by
 * design; the scraper hits each entry independently.
 */

/** Supported ATS providers. Adding a new one means: (1) update this set, (2) add a Tier-1 handler. */
export const SUPPORTED_ATS = Object.freeze(["ashby", "greenhouse", "lever"]);

/** Recognized `source` values. Free-form strings are also accepted but these are the canonical set. */
export const KNOWN_SOURCES = Object.freeze([
  "manual",
  "manual_confirmed", // auto-promoted entry that a human has reviewed and approved
  "auto_promoted_from_builtin",
  "auto_promoted_from_yc",
  "auto_promoted_from_wellfound",
  "auto_promoted_from_vc_board",
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Validate a single companies.yml entry. Throws if invalid; otherwise returns the entry
 * unmodified (validation is shape-only, no normalization).
 *
 * @param {unknown} entry
 * @returns {object} the validated entry
 */
export function validateCompanyEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`companies.yml entry must be an object, got: ${JSON.stringify(entry)}`);
  }

  const e = entry;
  const required = ["canonical_name", "ats", "slug", "source", "added_date"];
  for (const k of required) {
    if (e[k] === undefined || e[k] === null || e[k] === "") {
      throw new Error(`companies.yml entry missing required field "${k}": ${JSON.stringify(e)}`);
    }
  }

  if (typeof e.canonical_name !== "string" || e.canonical_name.length > 100) {
    throw new Error(`canonical_name must be a string ≤100 chars: ${JSON.stringify(e.canonical_name)}`);
  }
  if (!SUPPORTED_ATS.includes(e.ats)) {
    throw new Error(`ats must be one of ${SUPPORTED_ATS.join("|")}, got: ${JSON.stringify(e.ats)}`);
  }
  if (typeof e.slug !== "string" || !SLUG_RE.test(e.slug)) {
    throw new Error(
      `slug must match ${SLUG_RE} (lowercase alphanumeric, dashes, underscores), got: ${JSON.stringify(e.slug)}`,
    );
  }
  if (typeof e.source !== "string" || e.source.length > 80) {
    throw new Error(`source must be a string ≤80 chars: ${JSON.stringify(e.source)}`);
  }
  if (typeof e.added_date !== "string" || !ISO_DATE_RE.test(e.added_date)) {
    throw new Error(`added_date must be YYYY-MM-DD, got: ${JSON.stringify(e.added_date)}`);
  }
  if (e.notes !== undefined && typeof e.notes !== "string") {
    throw new Error(`notes must be a string, got: ${JSON.stringify(e.notes)}`);
  }
  if (e.last_seen_active !== undefined && e.last_seen_active !== null) {
    if (typeof e.last_seen_active !== "string" || !ISO_DATE_RE.test(e.last_seen_active)) {
      throw new Error(`last_seen_active must be YYYY-MM-DD, got: ${JSON.stringify(e.last_seen_active)}`);
    }
  }
  if (e.paused !== undefined && typeof e.paused !== "boolean") {
    throw new Error(`paused must be boolean, got: ${JSON.stringify(e.paused)}`);
  }
  if (e.needs_slug_verification !== undefined && typeof e.needs_slug_verification !== "boolean") {
    throw new Error(
      `needs_slug_verification must be boolean, got: ${JSON.stringify(e.needs_slug_verification)}`,
    );
  }

  return e;
}

/**
 * Validate a list of entries and check for (ats, slug) uniqueness.
 * @param {unknown[]} entries
 * @returns {object[]} validated entries
 */
export function validateCompaniesList(entries) {
  if (!Array.isArray(entries)) {
    throw new Error(`companies.yml top-level must be a list, got: ${typeof entries}`);
  }
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const v = validateCompanyEntry(entry);
    const key = `${v.ats}:${v.slug}`;
    if (seen.has(key)) {
      throw new Error(`companies.yml duplicate entry for ats/slug pair: ${key}`);
    }
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** True if (ats, slug) already exists in the list. */
export function hasEntry(list, ats, slug) {
  return list.some((e) => e.ats === ats && e.slug === slug);
}
