/**
 * ats-slug-extractor.mjs — recognize the ATS provider and company slug from a job URL.
 *
 * Why this exists: the auto-promotion engine (promote-company.mjs) watches every URL
 * the pipeline surfaces. When a BuiltIn-discovered role's apply form lives on a known
 * ATS (jobs.ashbyhq.com/<slug>, boards.greenhouse.io/<slug>, jobs.lever.co/<slug>, …),
 * we capture <slug> here and append it to companies.yml so the next scan run gets
 * direct ATS depth for that company. See autoapply/SCRAPER_AUDIT.md §7 quick-win #4.
 *
 * Pure functions, no IO. Tested in ats-slug-extractor.test.mjs.
 */

// ATS providers we support. Adding one means: (1) add an extractor below, (2) wire it
// into extractAtsInfo(), (3) add the provider to scripts/lib/companies-schema.mjs
// SUPPORTED_ATS, (4) add a Tier-1 handler in scan-jobs.mjs.
export const SUPPORTED_ATS = Object.freeze(["ashby", "greenhouse", "lever"]);

function safeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

function hostOf(u) {
  return u.hostname.replace(/^www\./, "").toLowerCase();
}

// Slugs in URL paths look like company identifiers: lowercase, alphanumerics, dashes,
// underscores. We tolerate digits anywhere (e.g., "modal-labs", "co2025") but require
// the first char to be alphanumeric (defends against accidentally extracting "/jobs"
// or other reserved path segments).
const VALID_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;

function isReservedPathSegment(s) {
  // Tokens that show up in ATS URLs as fixed parts, not company slugs.
  return [
    "jobs",
    "job",
    "embed",
    "api",
    "v0",
    "v1",
    "v2",
    "board",
    "boards",
    "job-board",
    "postings",
    "posting",
    "apply",
    "candidates",
    "candidate",
    "auth",
    "login",
    "search",
    "company",
    "companies",
  ].includes(s);
}

/**
 * Extract an Ashby slug from a URL.
 *
 * Patterns recognized:
 *   - https://jobs.ashbyhq.com/<slug>
 *   - https://jobs.ashbyhq.com/<slug>/<job-id>
 *   - https://jobs.ashbyhq.com/<slug>/<job-id>/application
 *   - https://ashbyhq.com/<slug>/...
 *   - https://api.ashbyhq.com/posting-api/job-board/<slug>
 *   - https://<slug>.ashbyhq.com/... (rare custom-domain form; usually still funneled
 *     through jobs.ashbyhq.com, but defended against)
 *
 * @returns {string | null}
 */
export function extractAshbySlug(url) {
  const u = safeUrl(url);
  if (!u) return null;
  const host = hostOf(u);

  // API form: /posting-api/job-board/<slug>
  if (host === "api.ashbyhq.com") {
    const m = u.pathname.match(/^\/posting-api\/job-board\/([^/?#]+)/);
    if (m && VALID_SLUG_RE.test(m[1].toLowerCase()) && !isReservedPathSegment(m[1].toLowerCase())) {
      return m[1].toLowerCase();
    }
    return null;
  }

  // Public job-board form: jobs.ashbyhq.com/<slug>/...
  if (host === "jobs.ashbyhq.com" || host === "ashbyhq.com") {
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length === 0) return null;
    const candidate = segs[0].toLowerCase();
    if (VALID_SLUG_RE.test(candidate) && !isReservedPathSegment(candidate)) return candidate;
    return null;
  }

  // Custom-subdomain form: <slug>.ashbyhq.com (rare — Ashby supports CNAME'd subdomains
  // for premium tiers). The subdomain IS the slug.
  if (host.endsWith(".ashbyhq.com")) {
    const slug = host.replace(/\.ashbyhq\.com$/, "").toLowerCase();
    // Reject multi-label subdomains ("api.eu.ashbyhq.com") and reserved labels.
    if (slug.includes(".")) return null;
    if (["api", "www", "jobs"].includes(slug)) return null;
    if (VALID_SLUG_RE.test(slug)) return slug;
  }

  return null;
}

/**
 * Extract a Greenhouse slug.
 *
 * Patterns recognized:
 *   - https://boards.greenhouse.io/<slug>
 *   - https://boards.greenhouse.io/<slug>/jobs/<id>
 *   - https://job-boards.greenhouse.io/<slug>
 *   - https://job-boards.greenhouse.io/<slug>/jobs/<id>
 *   - https://boards-api.greenhouse.io/v1/boards/<slug>/jobs
 *   - https://<slug>.applytojob.com (some Greenhouse-adjacent hosts — not us, skip)
 *
 * @returns {string | null}
 */
export function extractGreenhouseSlug(url) {
  const u = safeUrl(url);
  if (!u) return null;
  const host = hostOf(u);

  // API form: /v1/boards/<slug>/...
  if (host === "boards-api.greenhouse.io") {
    const m = u.pathname.match(/^\/v\d+\/boards\/([^/?#]+)/);
    if (m && VALID_SLUG_RE.test(m[1].toLowerCase()) && !isReservedPathSegment(m[1].toLowerCase())) {
      return m[1].toLowerCase();
    }
    return null;
  }

  // Public board: boards.greenhouse.io/<slug>/... or job-boards.greenhouse.io/<slug>/...
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length === 0) return null;
    const candidate = segs[0].toLowerCase();
    if (VALID_SLUG_RE.test(candidate) && !isReservedPathSegment(candidate)) return candidate;
    return null;
  }

  return null;
}

/**
 * Extract a Lever slug.
 *
 * Patterns recognized:
 *   - https://jobs.lever.co/<slug>
 *   - https://jobs.lever.co/<slug>/<posting-id>
 *   - https://jobs.lever.co/<slug>/<posting-id>/apply
 *   - https://api.lever.co/v0/postings/<slug>
 *   - https://api.lever.co/v0/postings/<slug>/<posting-id>
 *
 * @returns {string | null}
 */
export function extractLeverSlug(url) {
  const u = safeUrl(url);
  if (!u) return null;
  const host = hostOf(u);

  if (host === "api.lever.co") {
    const m = u.pathname.match(/^\/v\d+\/postings\/([^/?#]+)/);
    if (m && VALID_SLUG_RE.test(m[1].toLowerCase()) && !isReservedPathSegment(m[1].toLowerCase())) {
      return m[1].toLowerCase();
    }
    return null;
  }

  if (host === "jobs.lever.co" || host === "lever.co") {
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length === 0) return null;
    const candidate = segs[0].toLowerCase();
    if (VALID_SLUG_RE.test(candidate) && !isReservedPathSegment(candidate)) return candidate;
    return null;
  }

  return null;
}

/**
 * Identify the ATS and slug for a URL, if any. Returns { ats: null, slug: null } if
 * the URL doesn't look like a recognized ATS endpoint.
 *
 * @param {string} url
 * @returns {{ ats: 'ashby' | 'greenhouse' | 'lever' | null, slug: string | null }}
 */
export function extractAtsInfo(url) {
  const a = extractAshbySlug(url);
  if (a) return { ats: "ashby", slug: a };
  const g = extractGreenhouseSlug(url);
  if (g) return { ats: "greenhouse", slug: g };
  const l = extractLeverSlug(url);
  if (l) return { ats: "lever", slug: l };
  return { ats: null, slug: null };
}
