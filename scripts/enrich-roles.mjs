#!/usr/bin/env node

/**
 * enrich-roles.mjs — Claude-powered JD analysis for scanned roles
 *
 * Reads seen-urls.json, fetches full JD from Ashby/Greenhouse APIs,
 * sends each to Claude with the user's profile context, and stores
 * structured analysis back into an enrichment file.
 *
 * Runs automatically after scan-jobs.mjs, or standalone:
 *   node scripts/enrich-roles.mjs
 *   npm run enrich
 *
 * Requires ANTHROPIC_API_KEY in .env
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Load .env
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const ENRICHMENT_PATH = join(ROOT, "data", "enrichments.json");
const PROFILE_PATH = join(ROOT, "modes", "_profile.md");

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------
function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return fallback; }
}

function saveJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function loadProfile() {
  if (!existsSync(PROFILE_PATH)) return "";
  const full = readFileSync(PROFILE_PATH, "utf-8");
  // Extract key sections for a compact prompt
  const sections = [
    "## Background",
    "## Career Narrative",
    "## Target Roles",  // Removed "Your" prefix matching
    "## Your Comp Targets",
    "## Green Flags",
    "## Red Flags",
    "## Work Style Non-Negotiables",
    "## Scoring Guidance",
  ];
  // Just send the whole profile — it's compact enough (~3K tokens)
  return full;
}

// ---------------------------------------------------------------------------
// Fetch JD content from APIs
// ---------------------------------------------------------------------------
async function fetchAshbyJD(url) {
  // URL format: https://jobs.ashbyhq.com/{slug}/{jobId}
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [slug, jobId] = parts;

    const res = await fetch(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const job = (data.jobs || []).find((j) => j.id === jobId);
    if (!job) return null;

    return {
      title: job.title,
      company: slug,
      description: job.descriptionPlain || stripHtml(job.descriptionHtml || ""),
      location: job.location || "",
      remote: job.isRemote,
      department: job.department || "",
      team: job.team || "",
      comp: job.compensation,
    };
  } catch {
    return null;
  }
}

async function fetchGreenhouseJD(url) {
  // URL format: https://job-boards.greenhouse.io/{slug}/jobs/{jobId}
  // or https://boards.greenhouse.io/{slug}/jobs/{jobId}
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    // Find slug and jobId
    let slug, jobId;
    const jobsIdx = parts.indexOf("jobs");
    if (jobsIdx >= 1) {
      slug = parts[jobsIdx - 1];
      jobId = parts[jobsIdx + 1];
    }
    if (!slug || !jobId) return null;

    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`
    );
    if (!res.ok) return null;
    const job = await res.json();

    return {
      title: job.title,
      company: job.company_name || slug,
      description: stripHtml(job.content || ""),
      location: job.location?.name || "",
      remote: false,
      department: (job.departments || []).map((d) => d.name).join(", "),
      team: "",
      comp: null,
    };
  } catch {
    return null;
  }
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchViaExa(url, title) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return null;

  try {
    // Use Exa search with the URL as query to get cached content
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: url,
        type: "keyword",
        numResults: 1,
        contents: { text: { maxCharacters: 5000 } },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    if (!result?.text || result.text.length < 100) return null;

    return {
      title: title || result.title || "",
      company: "",
      description: result.text,
      location: "",
      remote: false,
      department: "",
      team: "",
      comp: null,
    };
  } catch {
    return null;
  }
}

// For Tier 2/3 roles where we know the company, try to find the JD
// on Ashby or Greenhouse by searching the company's board
async function fetchViaCompanyBoard(title, company) {
  if (!company) return null;
  const slug = company.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/\s+/g, "");

  // Try Ashby first
  try {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
    if (res.ok) {
      const data = await res.json();
      // Find a job with similar title
      const cleanTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      const match = (data.jobs || []).find((j) => {
        const jTitle = j.title.toLowerCase().replace(/[^a-z0-9 ]/g, "");
        return jTitle.includes(cleanTitle) || cleanTitle.includes(jTitle);
      });
      if (match) {
        return {
          title: match.title,
          company: slug,
          description: match.descriptionPlain || stripHtml(match.descriptionHtml || ""),
          location: match.location || "",
          remote: match.isRemote,
          department: match.department || "",
          team: match.team || "",
          comp: match.compensation,
        };
      }
    }
  } catch {}

  // Try Greenhouse
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    if (res.ok) {
      const data = await res.json();
      const cleanTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      const match = (data.jobs || []).find((j) => {
        const jTitle = j.title.toLowerCase().replace(/[^a-z0-9 ]/g, "");
        return jTitle.includes(cleanTitle) || cleanTitle.includes(jTitle);
      });
      if (match) {
        // Need detail call for content
        const detailRes = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${match.id}`
        );
        if (detailRes.ok) {
          const detail = await detailRes.json();
          return {
            title: detail.title,
            company: detail.company_name || slug,
            description: stripHtml(detail.content || ""),
            location: detail.location?.name || "",
            remote: false,
            department: (detail.departments || []).map((d) => d.name).join(", "),
            team: "",
            comp: null,
          };
        }
      }
    }
  } catch {}

  return null;
}

async function fetchViaHtml(url, title) {
  // Generic HTML fetch — works for BuiltIn, YC, VC boards, etc.
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; career-ops/1.0)" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Strip HTML tags and get text content
    const text = stripHtml(html);
    if (text.length < 200) return null; // Too short to be a real JD

    // Extract company from page title
    const pageTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = pageTitleMatch ? pageTitleMatch[1].trim() : "";

    // Try to find the JD section (heuristic: longest text block)
    // For BuiltIn pages, the JD is usually after the company info
    const jdText = text.length > 5000 ? text.slice(0, 5000) : text;

    return {
      title: title || pageTitle,
      company: "",
      description: jdText,
      location: "",
      remote: /remote/i.test(jdText),
      department: "",
      team: "",
      comp: null,
    };
  } catch {
    return null;
  }
}

async function fetchJD(url, title, company) {
  if (url.includes("ashbyhq.com")) return fetchAshbyJD(url);
  if (url.includes("greenhouse.io")) return fetchGreenhouseJD(url);

  // VC portfolio boards — these often redirect to Ashby/Greenhouse
  if (url.includes("jobs.8vc.com") || url.includes("jobs.generalcatalyst.com") ||
      url.includes("jobs.insightpartners.com") || url.includes("jobs.greylock.com")) {
    // Try HTML fetch — these boards render the JD inline
    const htmlResult = await fetchViaHtml(url, title);
    if (htmlResult && htmlResult.description.length > 300) return htmlResult;
  }

  // BuiltIn, YC Work at a Startup — HTML fetchable
  if (url.includes("builtin.com/job/") || url.includes("workatastartup.com/jobs/")) {
    const htmlResult = await fetchViaHtml(url, title);
    if (htmlResult && htmlResult.description.length > 300) return htmlResult;
  }

  // RevOps Careers, VentureLoop, other aggregators — try HTML
  if (url.includes("revopscareers.com/job/") || url.includes("ventureloop.com/")) {
    const htmlResult = await fetchViaHtml(url, title);
    if (htmlResult && htmlResult.description.length > 300) return htmlResult;
  }

  // Fallback: try to find the JD on the company's actual job board
  if (company) return fetchViaCompanyBoard(title, company);

  // Last resort: try fetching any URL
  const htmlResult = await fetchViaHtml(url, title);
  if (htmlResult && htmlResult.description.length > 300) return htmlResult;

  return null;
}

// ---------------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------------
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 15000]; // 2s, 5s, 15s backoff

async function analyzeJD(jdData, profile) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ERROR: ANTHROPIC_API_KEY not set in .env");
    process.exit(1);
  }

  // Truncate JD to ~4K chars to keep costs down
  const jdText = jdData.description.slice(0, 4000);

  const prompt = `You are a GTM career advisor analyzing a job posting for a specific candidate. Be direct and opinionated.

## Candidate Profile
${profile}

## Job Posting
**Title:** ${jdData.title}
**Company:** ${jdData.company}
**Location:** ${jdData.location}${jdData.remote ? " (Remote)" : ""}
**Department:** ${jdData.department || "N/A"}
**Team:** ${jdData.team || "N/A"}
${jdData.comp ? `**Compensation:** ${JSON.stringify(jdData.comp)}` : ""}

**Description:**
${jdText}

## Instructions
Analyze this role against the candidate's profile. Return ONLY valid JSON with this exact structure:

{
  "comp_range": "salary range if mentioned, or 'Not listed'",
  "location": "NYC / Remote US / Hybrid NYC / San Francisco / On-site [City] / Remote — extract from JD text",
  "work_policy": "remote / hybrid / on-site / not specified",
  "stack": ["tool1", "tool2"],
  "team_context": "who this reports to and team size if mentioned",
  "green_flags": ["specific things from the JD that match the candidate's green flags"],
  "red_flags": ["specific things from the JD that match the candidate's red flags, or gaps"],
  "build_component": true or false,
  "ai_signal": true or false,
  "company_stage": "Series X / public / unknown — infer from JD if not stated",
  "fit_score": 1-10 integer,
  "verdict": "2-3 sentence assessment. Be specific about why this is or isn't a fit. Reference the candidate's actual experience and the JD's actual requirements."
}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.status === 529 || res.status === 503 || res.status === 429) {
      // Overloaded / rate limited — retry with backoff
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 15000;
        process.stdout.write(` [retry ${attempt + 1} in ${delay / 1000}s]`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.error(`  API overloaded after ${MAX_RETRIES} retries`);
      return null;
    }

    if (!res.ok) {
      const err = await res.text();
      console.error(`  Claude API error (${res.status}): ${err.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";

    // Extract JSON from response
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {
      console.error(`  Failed to parse Claude response`);
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n=== Role Enrichment — ${new Date().toISOString().slice(0, 10)} ===\n`);

  const seenUrls = loadJson(SEEN_PATH, {});
  const enrichments = loadJson(ENRICHMENT_PATH, {});
  const profile = loadProfile();

  if (!profile) {
    console.error("No profile found at modes/_profile.md");
    process.exit(1);
  }

  // Find URLs that need enrichment: new ones + previously failed API errors (not no_jd)
  const SKIP_DOMAINS = ["substack.com", "medium.com", "bvp.com", "twitter.com", "youtube.com", "x.com"];
  const toEnrich = [];
  for (const [url, meta] of Object.entries(seenUrls)) {
    if (SKIP_DOMAINS.some((d) => url.includes(d))) continue;

    const existing = enrichments[url];
    if (existing) {
      // Retry API failures (overloaded, analysis_failed) but not no_jd (permanent)
      if (existing.error === "analysis_failed" || existing.error === "api_overloaded") {
        toEnrich.push({ url, meta, retry: true });
      }
      continue;
    }
    toEnrich.push({ url, meta, retry: false });
  }

  console.log(`  Total seen URLs: ${Object.keys(seenUrls).length}`);
  console.log(`  Already enriched: ${Object.keys(enrichments).length}`);
  console.log(`  To enrich: ${toEnrich.length}\n`);

  if (toEnrich.length === 0) {
    console.log("  Nothing new to enrich.\n");
    return;
  }

  let enriched = 0;
  let failed = 0;

  for (const { url, meta } of toEnrich) {
    const shortTitle = (meta.title || "").slice(0, 50);
    process.stdout.write(`  [${enriched + failed + 1}/${toEnrich.length}] ${shortTitle}...`);

    // Extract company name from title for Tier 2/3 lookups
    const title = meta.title || "";
    let company = "";
    const saraMatch = title.match(/Sara's List\s*-\s*.+?\s+at\s+(.+?)$/i);
    if (saraMatch) company = saraMatch[1].trim();
    if (!company && url.includes("revopscareers.com/job/")) {
      const slug = url.split("/job/")[1] || "";
      const cleaned = slug.replace(/^whatjobs-us-/, "").replace(/^lensa-/, "");
      const parts = cleaned.split("-");
      const roleWords = ["head","director","manager","senior","vp","lead","revenue","revops","gtm","sales","associate","staff","principal","remote"];
      const coParts = [];
      for (const p of parts) { if (roleWords.includes(p.toLowerCase())) break; coParts.push(p); }
      if (coParts.length > 0 && coParts.length <= 4) company = coParts.join("-");
    }

    // Clean title for matching
    const cleanedTitle = title
      .replace(/^Sara's List\s*-\s*/i, "")
      .replace(/\s*-\s*RevOps Careers$/i, "")
      .replace(/(?:\s+at\s+|\s+@\s+|\s*[|—–]\s*).+$/, "")
      .trim();

    // Fetch JD content (Tier 1 via API, Tier 2/3 via company board lookup)
    const jdData = await fetchJD(url, cleanedTitle, company);
    if (!jdData || !jdData.description) {
      process.stdout.write(" no JD content\n");
      enrichments[url] = { error: "no_jd", timestamp: new Date().toISOString() };
      failed++;
      continue;
    }

    // Analyze with Claude (with retry for transient errors)
    const analysis = await analyzeJD(jdData, profile);
    if (!analysis) {
      process.stdout.write(" analysis failed\n");
      enrichments[url] = { error: "analysis_failed", timestamp: new Date().toISOString() };
      failed++;
      // Save incrementally so we don't lose progress on crash
      saveJson(ENRICHMENT_PATH, enrichments);
      continue;
    }

    enrichments[url] = {
      ...analysis,
      timestamp: new Date().toISOString(),
    };

    process.stdout.write(` ${analysis.fit_score}/10 — ${analysis.verdict?.slice(0, 60)}...\n`);
    enriched++;

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  // Save
  saveJson(ENRICHMENT_PATH, enrichments);

  console.log(`\n  Enriched: ${enriched}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total enrichments: ${Object.keys(enrichments).length}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
