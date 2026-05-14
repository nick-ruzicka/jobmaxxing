/**
 * apply-url-extractor.mjs — find an ATS apply URL inside a fetched JD page.
 *
 * Why this exists: scan-jobs.mjs auto-promotes companies when the role URL is
 * already an ATS URL (jobs.ashbyhq.com/<slug>, …). But the textbook BuiltIn case
 * is different — the discovery URL is a BuiltIn page (builtin.com/job/...), and
 * the ATS apply form lives behind an "Apply Now" link on that page. After
 * enrich-roles.mjs fetches the BuiltIn HTML for JD analysis, we comb that same
 * HTML for the ATS link the user would actually click. If found, the apply URL
 * gets fed to processRolePromotion() and the company is promoted into
 * companies.yml for future direct Tier-1 scans. See:
 *
 *   - autoapply/SCRAPER_AUDIT.md §7 quick-win #4 (the "textbook case")
 *   - scripts/scan-jobs.mjs around line 1720 (scan-time complement)
 *
 * Pure functions, no IO. Tested in apply-url-extractor.test.mjs.
 */
import { jsonLdBlocks, findJobPostings } from "./extract-comp.mjs";
import { extractAtsInfo } from "./ats-slug-extractor.mjs";

/**
 * Walk a JSON-LD JobPosting node looking for any string field that holds a URL
 * that ats-slug-extractor recognizes. JSON-LD doesn't have a single canonical
 * field for "apply URL" — different ATSes write it under `url`, `sameAs`,
 * `directApply.url`, `hiringOrganization.sameAs`, etc. So we scan all string
 * leaves and pick the first one that ats-slug-extractor accepts.
 */
function scanJsonLdForAtsUrl(node) {
  const stack = [node];
  const seen = new Set();
  while (stack.length) {
    const o = stack.pop();
    if (o == null) continue;
    if (typeof o === "string") {
      // Only consider strings that look like URLs to avoid wasting cycles on prose.
      if (o.startsWith("http://") || o.startsWith("https://")) {
        const info = extractAtsInfo(o);
        if (info.ats && info.slug) return o;
      }
      continue;
    }
    if (typeof o !== "object") continue;
    if (seen.has(o)) continue;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const v of o) stack.push(v);
      continue;
    }
    for (const v of Object.values(o)) stack.push(v);
  }
  return null;
}

// Regex fallback for when JSON-LD doesn't surface an apply URL: comb the raw HTML
// for any href / src / inline string that looks like an ATS posting URL. We're
// deliberately strict — the path must contain at least one segment after the
// host (e.g., jobs.ashbyhq.com/foo, not bare jobs.ashbyhq.com) — to avoid
// promoting on a navigational link to Ashby's homepage.
const ATS_HOSTS_PATTERN =
  /https?:\/\/(?:jobs\.ashbyhq\.com|ashbyhq\.com|api\.ashbyhq\.com|boards\.greenhouse\.io|job-boards\.greenhouse\.io|boards-api\.greenhouse\.io|jobs\.lever\.co|api\.lever\.co)\/[^\s"'<>)]+/gi;

function scanRawHtmlForAtsUrl(html) {
  if (typeof html !== "string" || html.length === 0) return null;
  const matches = html.match(ATS_HOSTS_PATTERN);
  if (!matches) return null;
  for (const raw of matches) {
    // Trim trailing punctuation that often gets glued onto URLs by HTML/Markdown
    // (commas, semicolons, closing parens, periods).
    const cleaned = raw.replace(/[.,;:)\]]+$/, "");
    const info = extractAtsInfo(cleaned);
    if (info.ats && info.slug) return cleaned;
  }
  return null;
}

/**
 * Try to find an ATS apply URL inside the fetched JD page.
 *
 * Strategy (in order — first hit wins):
 *   1. JSON-LD JobPosting nodes: walk every string leaf, return the first that
 *      ats-slug-extractor recognizes. JSON-LD is the gold standard because
 *      sites publish it for search-engine consumption.
 *   2. Raw HTML regex: scan for ATS hostnames in any context (href, src,
 *      inline JS, prose). Less precise but catches cases where the apply link
 *      lives outside JSON-LD (most BuiltIn pages today).
 *
 * @param {string} rawHtml  — the JD page HTML
 * @returns {string | null}  — the ATS URL if found and recognized, else null
 */
export function extractApplyUrl(rawHtml) {
  if (!rawHtml || typeof rawHtml !== "string") return null;

  // 1. JSON-LD path
  const blocks = jsonLdBlocks(rawHtml);
  for (const block of blocks) {
    const jobPostings = findJobPostings(block);
    for (const jp of jobPostings) {
      const url = scanJsonLdForAtsUrl(jp);
      if (url) return url;
    }
    // Some pages emit a non-JobPosting node that still references the ATS URL
    // (e.g., Organization with sameAs). Worth a peek before falling back.
    const fromBlock = scanJsonLdForAtsUrl(block);
    if (fromBlock) return fromBlock;
  }

  // 2. Raw HTML regex fallback
  return scanRawHtmlForAtsUrl(rawHtml);
}
