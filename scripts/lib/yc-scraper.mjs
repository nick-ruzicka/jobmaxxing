/**
 * yc-scraper.mjs — direct crawler for Y Combinator's "Work at a Startup" board.
 *
 * Audit (autoapply/SCRAPER_AUDIT.md) surprise finding: "ycombinator.com has a 100%
 * hit rate (4/4 enriched are fit≥7) but we don't crawl it directly — it leaks in
 * via Exa Tier 6 at a trickle of 5 URLs total. The strongest signal:effort gap in
 * the whole pipeline."
 *
 * Strategy: workatastartup.com renders its job board client-side; the underlying
 * Algolia search powers a JSON API that returns structured job records. Our
 * approach is HTML-first with a graceful fallback: we fetch the rendered jobs
 * page (server-side it embeds a hydration payload as JSON in a <script
 * id="__NEXT_DATA__" type="application/json"> block), extract that JSON, and walk
 * the postings.
 *
 * If the page shape changes (YC has refactored their stack multiple times in the
 * last year), the parser fails open: returns [] with an error tag rather than
 * crashing the whole scrape run. The caller falls back to the Exa-keyword Tier 10
 * we already have.
 *
 * Filtering: tier 10 currently has 4 keyword variants (YC_SEARCHES). We keep the
 * same keyword set as the SAME source of truth — passed in by the caller.
 *
 * (As with lever-scraper, fetch is injectable for tests.)
 */

const YC_BASE = "https://www.workatastartup.com";

/**
 * Normalize a YC posting record (extracted from the hydration JSON) into the
 * CareerOps Tier-1 shape.
 *
 * Known field locations in the hydration payload (subject to change):
 *   - title, role_type, location, work_type
 *   - company.name, company.id, company.batch, company.stage, company.team_size
 *   - apply_url / hosted_url
 *   - description (HTML)
 */
export function normalizeYcJob(job) {
  if (!job || typeof job !== "object") return null;
  const title = (job.title || job.role || "").trim();
  if (!title) return null;
  const company = (job.company && (job.company.name || job.company.title)) || "";
  const url =
    job.hosted_url ||
    job.apply_url ||
    (job.id ? `${YC_BASE}/jobs/${job.id}` : "");
  const location =
    job.location ||
    (Array.isArray(job.locations) ? job.locations.filter(Boolean).join(", ") : "");
  const workplaceType =
    job.work_type ||
    (job.remote === true ? "remote" : "") ||
    job.workplaceType ||
    "";

  let publishedDate = "";
  if (typeof job.created_at === "string") publishedDate = job.created_at;
  else if (typeof job.posted_at === "string") publishedDate = job.posted_at;
  else if (typeof job.published_at === "string") publishedDate = job.published_at;

  // Comp: YC postings sometimes have salary_min/max and equity_min/max.
  let comp = "";
  if (job.salary_min && job.salary_max) {
    comp = `$${Math.round(job.salary_min / 1000)}K-$${Math.round(job.salary_max / 1000)}K`;
  } else if (typeof job.salary_range === "string") {
    comp = job.salary_range;
  }

  return {
    title,
    company,
    url,
    publishedDate,
    location,
    workplaceType,
    source: "Tier 1: YC",
    comp,
    text: (job.description || job.description_text || "").replace(/<[^>]+>/g, "").trim(),
    highlights: "",
    ycBatch: job.company?.batch || "",
    ycStage: job.company?.stage || "",
  };
}

/**
 * Extract the YC hydration JSON from a rendered jobs page. Looks for either
 * Next.js's `__NEXT_DATA__` script or a generic `<script id="server_data" …>`
 * pattern (YC has used both). Returns the parsed JSON, or null if not found.
 */
export function extractYcHydration(html) {
  if (typeof html !== "string" || !html) return null;

  // Next.js __NEXT_DATA__ pattern (most common)
  const m1 = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (m1) {
    try {
      return JSON.parse(m1[1]);
    } catch {
      /* fall through */
    }
  }

  // Alternate "server_data" / "data" pattern
  const m2 = html.match(
    /<script[^>]+id=["'](?:server_data|__YC_DATA__)["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (m2) {
    try {
      return JSON.parse(m2[1]);
    } catch {
      /* fall through */
    }
  }

  return null;
}

/**
 * Walk the hydration JSON looking for an array of job postings. The shape has
 * changed multiple times historically; we look for any array where every element
 * has both a `title` and either a `company` or `company_id` field.
 *
 * Returns an array of raw posting objects (un-normalized).
 */
export function findJobsInHydration(payload) {
  if (!payload || typeof payload !== "object") return [];
  const results = [];
  const seen = new WeakSet();

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      // Is this an array of postings? Heuristic: at least one element has title +
      // (company || company_id || company_name).
      const looksLikeJobs =
        node.length > 0 &&
        node.every(
          (e) =>
            e &&
            typeof e === "object" &&
            typeof e.title === "string" &&
            (e.company || e.company_id || e.company_name),
        );
      if (looksLikeJobs) {
        results.push(...node);
        return;
      }
      for (const item of node) walk(item);
      return;
    }
    for (const k of Object.keys(node)) walk(node[k]);
  }

  walk(payload);
  return results;
}

/**
 * Fetch and parse a single YC search page.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ jobs: object[], error: string | null }>}
 */
export async function fetchYcSearch(query, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  if (typeof f !== "function") return { jobs: [], error: "no-fetch" };

  // YC's URL pattern: /jobs?demographic=any&hasEquity=any&hasSalary=any&query=<q>
  const url =
    `${YC_BASE}/jobs?` +
    new URLSearchParams({
      query,
      demographic: "any",
      hasEquity: "any",
      hasSalary: "any",
    }).toString();

  try {
    const controller = opts.timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
    const res = await f(url, controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);

    if (!res.ok) return { jobs: [], error: `http-${res.status}` };
    const html = await res.text();
    const hydration = extractYcHydration(html);
    if (!hydration) return { jobs: [], error: "no-hydration" };
    const jobs = findJobsInHydration(hydration);
    return { jobs, error: null };
  } catch (e) {
    return { jobs: [], error: e && e.name === "AbortError" ? "timeout" : "network" };
  }
}

/**
 * Scan YC for a set of search queries. Returns { results, failed, checked }
 * matching scanLever / scanAshby / scanGreenhouse.
 *
 * @param {string[]} queries
 * @param {object} [opts]
 */
export async function scanYc(queries, opts = {}) {
  const results = [];
  const failed = [];
  let checked = 0;
  // Dedup across queries (same job often surfaces on multiple searches).
  const seenUrls = new Set();

  for (const query of queries) {
    checked++;
    const { jobs, error } = await fetchYcSearch(query, opts);
    if (error) {
      failed.push(`${query} (${error})`);
      continue;
    }
    for (const j of jobs) {
      const r = normalizeYcJob(j);
      if (!r || !r.url) continue;
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      results.push(r);
    }
  }
  return { results, failed, checked };
}
