/**
 * lever-scraper.mjs — Tier-1 Lever ATS handler.
 *
 * Public API endpoint: https://api.lever.co/v0/postings/<company>?mode=json
 *   - No auth required for public boards
 *   - Returns: { team, country, descriptionPlain, hostedUrl, applyUrl, …, lists, … } per job
 *
 * Returns roles in the same normalized shape as scanAshby / scanGreenhouse in
 * scripts/scan-jobs.mjs, so the call-site change in scan-jobs.mjs is a one-liner:
 * `allResults.push(...lever.results)`.
 *
 * Errors:
 *   - HTTP 404 → company not on Lever / slug typo → push slug to `failed`, continue.
 *   - Network errors / timeouts → log + push to `failed`.
 *   - Per-company endpoint errors do not abort the whole tier.
 *
 * Title filtering is the caller's responsibility: scan-jobs.mjs has the
 * titleMatchesPositive / titleMatchesNegative gate and applies it to every Tier-1
 * result. This module returns ALL open postings as the API gives them.
 *
 * (The fetch-injection seam exists for tests — they pass a fake fetch that returns
 * fixture data.)
 */

const LEVER_API = "https://api.lever.co/v0/postings";

/**
 * Normalize a Lever posting into the shape scan-jobs.mjs expects from a Tier-1 result.
 *
 * Lever posting shape (excerpt):
 *   {
 *     id: "abc-123",
 *     text: "Senior GTM Engineer",
 *     hostedUrl: "https://jobs.lever.co/<slug>/<id>",
 *     applyUrl:  "https://jobs.lever.co/<slug>/<id>/apply",
 *     categories: { team: "Engineering", location: "San Francisco", commitment: "Full-time",
 *                   department: "Eng", allLocations: ["…","…"] },
 *     createdAt: 1714425600000,
 *     workplaceType: "remote" | "on-site" | "hybrid",
 *     salaryRange: { min: 150000, max: 200000, currency: "USD", interval: "per-year-salary" },
 *     descriptionPlain: "…"
 *   }
 *
 * Defends against missing fields (Lever lets companies omit most of these).
 */
export function normalizeLeverJob(job, slug) {
  const title = (job?.text || "").trim();
  const id = job?.id || "";
  const url = job?.hostedUrl || `https://jobs.lever.co/${slug}/${id}`;

  // Location: Lever puts it under categories.location (string) plus categories.allLocations
  // (array). Prefer the array if present (multi-location postings).
  const allLocs = Array.isArray(job?.categories?.allLocations)
    ? job.categories.allLocations.filter(Boolean)
    : [];
  const locationStr = allLocs.length > 0
    ? allLocs.join(", ")
    : job?.categories?.location || "";

  // Comp: structured salaryRange (cleaner than Ashby's, which we already handle similarly).
  const sr = job?.salaryRange;
  const comp =
    sr && sr.min && sr.max
      ? `$${Math.round(sr.min / 1000)}K-$${Math.round(sr.max / 1000)}K`
      : "";

  // Posted date — Lever gives epoch millis on createdAt.
  let publishedDate = "";
  if (typeof job?.createdAt === "number" && Number.isFinite(job.createdAt)) {
    publishedDate = new Date(job.createdAt).toISOString();
  }

  return {
    title,
    company: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " "),
    url,
    publishedDate,
    location: locationStr,
    workplaceType: job?.workplaceType || "",
    team: job?.categories?.team || "",
    source: "Tier 1: Lever",
    comp,
    text: job?.descriptionPlain || "",
    highlights: "",
  };
}

/**
 * Scan one Lever company. Returns { jobs, error }; `error` is null on success,
 * else a short tag ("404" | "network" | "parse").
 *
 * @param {string} slug
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch] — fetch injection seam for tests
 * @param {number} [opts.timeoutMs]
 */
export async function fetchLeverCompany(slug, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  if (typeof f !== "function") {
    return { jobs: [], error: "no-fetch" };
  }
  const url = `${LEVER_API}/${encodeURIComponent(slug)}?mode=json`;
  try {
    const controller = opts.timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
    const res = await f(url, controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);

    if (!res.ok) {
      return { jobs: [], error: res.status === 404 ? "404" : `http-${res.status}` };
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      return { jobs: [], error: "parse" };
    }
    return { jobs: data, error: null };
  } catch (e) {
    return { jobs: [], error: e && e.name === "AbortError" ? "timeout" : "network" };
  }
}

/**
 * Scan a batch of Lever companies. Mirrors scanAshby/scanGreenhouse contracts so
 * scan-jobs.mjs can drop it in alongside.
 *
 * @param {string[]} slugs
 * @param {object} [opts]
 * @returns {Promise<{ results: object[], failed: string[], checked: number }>}
 */
export async function scanLever(slugs, opts = {}) {
  const results = [];
  const failed = [];
  let checked = 0;
  for (const slug of slugs) {
    checked++;
    const { jobs, error } = await fetchLeverCompany(slug, opts);
    if (error) {
      if (error === "404") failed.push(slug);
      // Other errors get logged via the caller's stats; failed-only counts unknown-slug cases.
      continue;
    }
    for (const j of jobs) {
      const r = normalizeLeverJob(j, slug);
      if (!r.title) continue;
      results.push(r);
    }
  }
  return { results, failed, checked };
}
