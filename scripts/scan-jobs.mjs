#!/usr/bin/env node

/**
 * scan-jobs.mjs — Multi-tier job sourcing for career-ops
 *
 * Tier 1: Ashby + Greenhouse per-company APIs (structured, real-time)
 * Tier 2: Exa neural search (broad discovery)
 * Tier 3: VC portfolio + HN Who's Hiring Exa queries
 *
 * Usage:
 *   node scripts/scan-jobs.mjs
 *   npm run scan-jobs
 *   npm run scan-jobs:morning
 *   npm run scan-jobs:evening
 *
 * Cron (twice daily at 8am and 6pm ET):
 *   0 8 * * *  cd /Users/nicholasruzicka/projects/job-search/nick-career-ops && npm run scan-jobs:morning >> /tmp/scan-jobs.log 2>&1
 *   0 18 * * * cd /Users/nicholasruzicka/projects/job-search/nick-career-ops && npm run scan-jobs:evening >> /tmp/scan-jobs.log 2>&1
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { locationFields, structuredLocationFields } from "./lib/location.mjs";
import { cleanTitle } from "./lib/title-cleanup.mjs";
import { companyKey } from "./lib/normalize-company.mjs";
import {
  AGGREGATOR_HOSTS,
  EXCLUDE_DOMAINS,
  classifySource,
} from "./lib/source-classification.mjs";
import { loadCompaniesGrouped } from "./lib/companies-load.mjs";
import {
  createPromotionRunState,
  processRolePromotion,
  PROMOTION_CAP_PER_RUN,
} from "./lib/promote-company.mjs";
import { scanLever } from "./lib/lever-scraper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Load .env manually (no dependency needed)
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

// Load tracked companies from the structured config/companies.yml schema. Returns
// { ashby: [slug, ...], greenhouse: [slug, ...], lever: [slug, ...], all: [entry, ...] }.
// Paused entries (paused: true) are excluded from the per-ATS slug arrays but
// included in `all` so the auto-promotion engine can see them for dedup.
function loadCompanies() {
  return loadCompaniesGrouped();
}

// --- Title relevance: anchor + role-token matcher ---------------------------
// A title is relevant if it references GTM/Revenue/RevOps (an "anchor") AND
// carries an engineering / ops / systems / leadership word (a "role token").
// Anchors are matched as substrings (so "RevenueBase" still matches "revenue");
// role tokens are matched as WHOLE WORDS (so "Recruiter, Go-to-Market" fails —
// "recruiter" is not a role token — and "Designer, Go-to-Market AI" fails too).
// This replaced a flat substring allowlist that missed leadership variants like
// "Head of GTM Systems and Engineering" / "Director, GTM Strategy & Operations".
const TITLE_ANCHORS = [
  "gtm",
  "go to market",
  "go-to-market",
  "revenue",
  "revops",
  "rev ops",
  "sales operations",
  "sales ops",
];

const TITLE_ROLE_TOKENS = new Set([
  "engineer", "engineering", "operations", "ops", "systems", "infrastructure",
  "manager", "lead", "leader", "head", "director", "vp", "architect", "developer",
  // the bigram "vice president" is handled separately in titleHasRoleToken()
]);

const TITLE_NEGATIVE = [
  "account executive",
  "account manager",
  "business development representative",
  "bdr",
  "sdr",
  "customer success",
  "support engineer",
  "software engineer",
  "frontend",
  "backend",
  "data scientist",
  "machine learning engineer",
  "intern",
  "junior",
  "entry-level",
  "entry level",
  // recruiting / talent / people-ops / admin — surface on BuiltIn "GTM" searches
  // ("Recruiter, GTM & Engineering", "People Operations Manager - …", etc.)
  "recruiter",
  "talent acquisition",
  "talent partner",
  "people operations",
  "people ops",
  "hr operations",
  "hr ops",
  "executive assistant",
  // finance/accounting — "revenue" is an anchor, so "Revenue Accounting Manager"
  // and "Director, Revenue Accounting" pass the matcher; they are finance roles.
  "revenue accounting",
  "revenue accountant",
];

// Non-job content patterns (blogs, newsletters, articles)
const NON_JOB_URL_PATTERNS = [
  /substack\.com/,
  /medium\.com/,
  /\/blog\//,
  /\/article\//,
  /\/post\//,
  /\/newsletter/,
  /\/podcast/,
  /youtube\.com/,
  /\/p\//,           // Substack post URLs
  /\/insights\//,    // Apollo.io articles
  /\/resources\//,
  /\/learn\//,
  /\/guides?\//,
  /bvp\.com/,        // Bessemer research
  /bessemer/,
  /twitter\.com/,
  /x\.com\/(?!.+\/status)/,  // X profiles but not job-related tweets
  /prnewswire\.com/,
  /globenewswire\.com/,
  /businesswire\.com/,
  /innovationopenlab\.com/,
  /devcommx\.com/,
  /businessinsider\.com/,
  /markets\.businessinsider/,
  /napblog\.com/,
  // --- SEO link-farms (added 2026-05, Fix #1 aggregator-quarantine sweep) ---
  // Thin re-spun job-title pages with no real JD content; never produced a fit-≥6 role.
  // Also blocked at the Exa level via EXCLUDE_DOMAINS below — these regexes catch them
  // when they arrive via non-Exa tiers (Google Search, RevOps Co-op, etc.).
  /liveblog365\.com/,            // hirevector.liveblog365.com, jobflarely.liveblog365.com
  /totalh\.net/,                 // remotica.totalh.net
  /\.wuaze\.com/,                // hirepath.wuaze.com (+ the specific subdomains in EXCLUDE_DOMAINS)
  /\.page\.gd/,                  // *.page.gd free-host spam
  /saashero\.net/,
  /2x\.marketing/,
  /anywhereremotejobs\.com/,
  /kickstartremote\.com/,
];

const NON_JOB_TITLE_PATTERNS = [
  /\bpulse\b/i,
  /\bnewsletter\b/i,
  /\bdigest\b/i,
  /\bblog\b/i,
  /\bpodcast\b/i,
  /\bepisode\b/i,
  /\bwebinar\b/i,
  /\bthe new .+ discipline\b/i,
  /\bin \d{4}:/i,          // "AIRops in 2026: ..."
  /\bwhat they pay\b/i,
  /\bguide to\b/i,
  /\bhow to\b/i,
  /\bhow do you\b/i,       // "How Do You Hire a GTM Engineer"
  /\bwhat is\b/i,          // "What Is GTM Engineering?"
  /\btop \d+ .+ trends\b/i,
  /\bsalary in \d{4}\b/i,
  /\bbest .+ schools\b/i,
  /\bcareer to consider\b/i,
  /\bcompensation trends\b/i,
  /\btransforming\b.*\bworkflows\b/i,   // "Transforming Sales Workflows" articles
  /\bunderstanding\b.*\bgtm\b/i,        // "Understanding Agentic GTM"
  /\bgo-to-market guide\b/i,            // "Go-To-Market Guide"
  /\bgo-to-market strategy\b/i,         // "Go-To-Market Strategy" articles (not job postings)
  /\blaunches new\b/i,                  // "ContentRevOps Launches New..."
  /\btransform how\b/i,
  /\bbest .+ jobs\b/i,           // "Best Remote Revenue Operations Jobs 2026"
  /\bbest .+ jobs in\b/i,
];

function isNonJobContent(title, url) {
  if (NON_JOB_URL_PATTERNS.some((p) => p.test(url))) return true;
  if (NON_JOB_TITLE_PATTERNS.some((p) => p.test(title))) return true;
  return false;
}

// EXCLUDE_DOMAINS / AGGREGATOR_HOSTS now imported from ./lib/source-classification.mjs —
// canonical source of truth is config/source-classification.json. To add a new entry,
// edit the JSON; both Node scripts and the dashboard pick it up automatically.

// Tier 2: Exa broad discovery queries (keep existing)
const EXA_QUERIES = [
  "GTM Engineer role at a B2B SaaS company in New York City building go-to-market infrastructure",
  "Revenue Engineer or Revenue Operations Engineer job at a SaaS or AI company in NYC",
  "GTM Operations lead or manager role at a B2B SaaS company in New York",
  "Revenue Operations manager building GTM infrastructure at a high-growth SaaS company NYC",
  "Sales Operations Engineer role at an AI-first company in New York City",
  "GTM Engineer remote US role at a Series B SaaS company building automation and AI workflows",
  "Revenue Operations or RevOps role at a remote US AI company hiring now",
];

// Tier 3: VC portfolio + HN queries
const VC_QUERIES = [
  "GTM Engineer at an a16z portfolio company hiring now",
  "Revenue Operations role at a Sequoia-backed startup hiring",
  "GTM Operations or Revenue Engineer at a First Round or Greylock portfolio company",
  "GTM Engineer at a General Catalyst or Insight Partners or Tiger Global backed company",
];

const HN_QUERIES = [
  "GTM Engineer or Revenue Operations hiring Hacker News Who is Hiring April 2026",
  "Revenue Engineer or GTM Operations role YC startup hiring 2026",
];

// Tier 4: Niche GTM community boards
const GTM_CLUB_QUERIES = [
  "GTM Engineer job gtmengineers.com 2026",
  "Revenue Engineer GTM Engineers Club hiring",
];

const REVOPS_COOP_QUERIES = [
  "Revenue Operations GTM Engineer revopscoop.com hiring 2026",
  "GTM Operations job RevOps Co-op job board",
];

// Tier 5: Social signals (hiring manager intent)
const SOCIAL_QUERIES = [
  'we\'re hiring GTM Engineer twitter 2026 Series B',
  "looking for RevOps GTM Operations twitter startup hiring",
  "building GTM stack hiring engineer twitter SaaS 2026",
];

// Tier 6: Hiring intent signals (pre-posting)
const INTENT_QUERIES = [
  "building our GTM team from scratch 2026 Series B SaaS",
  "just hired our first GTM Engineer startup 2026",
  "looking for someone to build our revenue operations infrastructure 2026",
  "hiring GTM ops building the sales stack from zero startup",
];

// Tier 7: Funding news → likely hiring
const FUNDING_QUERIES = [
  "Series B funding 2026 B2B SaaS New York",
  "Series C raised 2026 AI company hiring go-to-market",
  "startup funding round 2026 revenue operations hiring",
];

// Tier 9: BuiltIn job board — direct search scrape (builtin.com/jobs?search=…&page=N)
// BuiltIn's own search has far better recall than Exa keyword search did; each query
// returns the manager/head/director/intern variants too. A handful of broad anchors
// + leadership phrases covers the space.
const BUILTIN_SEARCHES = [
  "GTM Engineering",        // ← also pulls "GTM Engineering Manager", "Head of GTM Systems and Engineering", etc.
  "GTM Engineer",
  "Revenue Operations",
  "RevOps Engineer",
  "Go-to-Market Engineer",
  "Sales Operations Engineer",
  "Revenue Systems",
  "Head of GTM",
  "Director GTM",
  "VP Revenue Operations",
];

// Tier 10: YC Work at a Startup
const YC_DOMAINS = ["workatastartup.com"];
const YC_SEARCHES = [
  "GTM Engineer",
  "Revenue Operations",
  "RevOps",
  "Go-to-Market",
];

// Tier 11: VC portfolio job boards
const VC_BOARD_CONFIGS = [
  { name: "8VC", domains: ["jobs.8vc.com"] },
  { name: "General Catalyst", domains: ["jobs.generalcatalyst.com"] },
  { name: "Insight Partners", domains: ["jobs.insightpartners.com"] },
  { name: "Greylock", domains: ["jobs.greylock.com"] },
  { name: "VentureLoop", domains: ["ventureloop.com"] },
];
const VC_BOARD_SEARCHES = [
  "GTM Engineer",
  "Revenue Operations",
  "RevOps Engineer",
  "Go-to-Market",
];

// Tier 12: Google-style broad discovery (catches what Exa misses)
const GOOGLE_QUERIES = [
  '"GTM Engineer" job opening 2026 B2B SaaS remote OR NYC',
  '"Revenue Operations Engineer" hiring 2026 startup Series B',
  '"GTM Engineer" OR "Revenue Engineer" apply now 2026',
  '"go-to-market engineer" role hiring SaaS AI company 2026',
];

const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const REPORTS_DIR = join(ROOT, "reports");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sevenDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function loadSeen() {
  if (!existsSync(SEEN_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveSeen(seen) {
  const dir = dirname(SEEN_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
}

// Lowercase, strip punctuation to spaces, collapse whitespace. Used for both
// the anchor substring test and the whole-word role-token test.
function normalizeTitle(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Returns the matched anchor phrase (for match-reason reporting), or null.
function titleMatchAnchor(title) {
  const n = normalizeTitle(title);
  if (!n) return null;
  for (const a of TITLE_ANCHORS) {
    if (n.includes(normalizeTitle(a))) return a;
  }
  return null;
}

function titleHasRoleToken(title) {
  const words = normalizeTitle(title).split(" ");
  if (words.some((w) => TITLE_ROLE_TOKENS.has(w))) return true;
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === "vice" && words[i + 1] === "president") return true;
  }
  return false;
}

function titleMatchesPositive(title) {
  return !!titleMatchAnchor(title) && titleHasRoleToken(title);
}

function titleMatchesNegative(title) {
  const t = (title || "").toLowerCase();
  return TITLE_NEGATIVE.some((kw) => t.includes(kw));
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hash = "";
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "gh_jid"]) {
      u.searchParams.delete(p);
    }
    u.hostname = u.hostname.replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

// Known aggregator suffixes to strip from company names
const AGGREGATOR_SUFFIXES = [
  /\s*[-–—|]\s*(?:Jobright\.AI|Remocate|Remotehunter|Jobgether|Built ?In\w*|RevOps Careers|Comeet|Sara's List|WeLoveProduct).*$/i,
  /\s*\|\s*.*$/,  // "Company | Aggregator"
];

// AGGREGATOR_HOSTS imported above. Quarantined re-syndicators are still stored in
// seen-urls.json (tagged source_tier:"aggregator") so the dashboard can toggle them on.
function classifySourceTier(url) {
  return classifySource(url).type === "aggregator" ? "aggregator" : undefined;
}

function cleanAggregatorCompany(company) {
  let cleaned = company;
  for (const pattern of AGGREGATOR_SUFFIXES) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.trim();
}

function extractCompany(title, url) {
  const saraMatch = title.match(/Sara's List\s*-\s*.+?\s+at\s+(.+?)$/i);
  if (saraMatch) return cleanAggregatorCompany(saraMatch[1].trim());

  // Aggregator URLs: extract company from title patterns
  // "CompanyName hiring Role in Location" (LinkedIn, BuiltIn, etc.)
  const hiringMatch = title.match(/^(.+?)\s+hiring\s+/i);
  if (hiringMatch && hiringMatch[1].length <= 30) {
    return cleanAggregatorCompany(hiringMatch[1].trim());
  }

  // "Role - Company" or "Role at Company" with aggregator suffix
  // "GTM Engineer - Hebbia" from builtin.com
  const dashCompanyMatch = title.match(/^.+?\s+-\s+([A-Z][A-Za-z0-9. ]+?)(?:\s*$|\s*[-|])/);
  if (dashCompanyMatch && dashCompanyMatch[1].length <= 30) {
    return cleanAggregatorCompany(dashCompanyMatch[1].trim());
  }

  // Jobgether, BuiltIn, join.com — company often in URL path
  if (url.includes("builtin.com")) {
    // Title format: "Role at Company" or "Company Role"
    const atMatch = title.match(/\bat\s+(.+?)$/i);
    if (atMatch) return cleanAggregatorCompany(atMatch[1]);
  }
  if (url.includes("join.com/companies/")) {
    const joinSlug = url.match(/companies\/([^/]+)/)?.[1] || "";
    if (joinSlug) return joinSlug.charAt(0).toUpperCase() + joinSlug.slice(1);
  }

  // remocate.app — strip "Vanta - Remocate" to "Vanta"
  if (url.includes("remocate.app")) {
    const parts = title.split(/\s*[-–—]\s*/);
    if (parts.length >= 1) return parts[0].trim();
  }

  if (url.includes("revopscareers.com/job/")) {
    const slug = url.split("/job/")[1] || "";
    const cleaned = slug.replace(/^whatjobs-us-/, "").replace(/^lensa-/, "").replace(/^jobsgemach-/, "");
    const parts = cleaned.split("-");
    const roleWords = ["head", "director", "manager", "senior", "vp", "lead", "revenue", "revops", "gtm", "sales"];
    let companyParts = [];
    for (const p of parts) {
      if (roleWords.includes(p.toLowerCase())) break;
      companyParts.push(p);
    }
    if (companyParts.length > 0 && companyParts.length <= 4) {
      return companyParts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  const atMatch = title.match(/(?:\s+at\s+|\s+@\s+|\s*[|—–]\s*)(.+?)$/i);
  if (atMatch) {
    const co = atMatch[1].trim();
    if (!/revops careers|sara's list|jobgether/i.test(co)) return co;
  }

  return "—";
}

function extractRoleTitle(title) {
  return title
    .replace(/^Sara's List\s*-\s*/i, "")
    .replace(/\s*-\s*RevOps Careers$/i, "")
    .replace(/\s*-\s*Jobsgemach$/i, "")
    .replace(/(?:\s+at\s+|\s+@\s+|\s*[|—–]\s*).+$/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Score overrides (fed back from evaluations)
// ---------------------------------------------------------------------------

function loadScoreOverrides() {
  const overridesPath = join(ROOT, "data", "score-overrides.json");
  if (!existsSync(overridesPath)) return { boost: {}, penalize: {}, block: [] };
  try {
    return JSON.parse(readFileSync(overridesPath, "utf-8"));
  } catch {
    return { boost: {}, penalize: {}, block: [] };
  }
}

const SCORE_OVERRIDES = loadScoreOverrides();

// ---------------------------------------------------------------------------
// Auto-scoring
// ---------------------------------------------------------------------------

// Companies/sectors that are poor ICP fit — penalize in scoring
const NON_ICP_COMPANIES = [
  /staffing|recruiting|recruitment|headhunt|talent\s+acqui/i,
  /agency|consulting\s+firm|consultancy/i,
  /government|defense|military/i,
  /healthcare|pharma|biotech|medical/i,
  /insurance|real\s+estate|construction/i,
  // Known staffing/recruiting firms by name
  /geekfind|hiredock|remotehunter|talent\.com|randstad|adecco|robert\s+half|hays|kforce|manpower/i,
];

function autoScore(role, company, location, trackedSlugs) {
  let score = 0;
  const t = role.toLowerCase();

  // Title match (base score)
  if (t.includes("gtm engineer")) score += 10;
  else if (t.includes("revenue engineer")) score += 9;
  else if (t.includes("gtm operations")) score += 8;
  else if (t.includes("revops") || t.includes("revenue operations")) score += 7;
  else if (t.includes("sales operations") || t.includes("sales ops")) score += 6;
  else if (t.includes("go-to-market") || t.includes("go to market")) score += 7;
  else score += 3;

  // Location bonus/penalty
  if (location === "NYC" || location === "Hybrid NYC") score += 2;
  else if (location === "Remote US" || location === "Remote NYC" || location === "Hybrid") score += 1;
  // Non-US locations: hard penalty — user is NYC-based, targeting US roles only
  const NON_US_LOCATIONS = ["são paulo", "singapore", "bengaluru", "bangalore", "london", "dublin", "mumbai", "pune", "mexico city", "berlin", "amsterdam", "toronto", "canada", "emea", "apac", "india", "united kingdom"];
  if (NON_US_LOCATIONS.some((s) => location.toLowerCase().includes(s))) score -= 4;

  // Tracked company bonus
  const companyLower = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (trackedSlugs.some((s) => companyLower.includes(s.replace(/-/g, "")))) {
    score += 1;
  }

  // Seniority signals
  const seniorPositive = ["senior", "lead", "head", "director", "staff", "principal"];
  const seniorNegative = ["analyst", "coordinator", "associate", "junior", "intern"];
  if (seniorPositive.some((s) => t.includes(s))) score += 1;
  if (seniorNegative.some((s) => t.includes(s))) score -= 2;

  // ICP penalty: non-target sectors get capped
  const companyAndRole = `${company} ${role}`.toLowerCase();
  if (NON_ICP_COMPANIES.some((p) => p.test(companyAndRole))) {
    score = Math.min(score, 5); // Cap at 5 for non-ICP companies
  }

  // Unknown company penalty — we can't verify ICP fit
  if (!company || company === "—" || company === "Unknown") {
    score = Math.min(score, 7); // Cap at 7 for unknown companies
  }

  // Feedback overrides from previous evaluations
  const coKey = (company || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (coKey && SCORE_OVERRIDES.block.includes(coKey)) {
    return 1; // Hard block — eval was <= 1.5/5
  }
  if (coKey && SCORE_OVERRIDES.penalize[coKey]) {
    score = Math.min(score, 4); // Eval was <= 2.5/5 or rejected
  }
  if (coKey && SCORE_OVERRIDES.boost[coKey]) {
    score += 2; // Eval was >= 4.0/5 — company is a known good fit
  }

  return Math.max(1, Math.min(10, score));
}

// ---------------------------------------------------------------------------
// Tier 1: Ashby API
// ---------------------------------------------------------------------------

async function scanAshby(slugs) {
  const results = [];
  const failed = [];
  let checked = 0;

  for (const slug of slugs) {
    checked++;
    try {
      const res = await fetch(
        `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`
      );
      if (!res.ok) {
        if (res.status === 404) failed.push(slug);
        continue;
      }
      const data = await res.json();
      const jobs = data.jobs || [];

      for (const job of jobs) {
        const title = job.title || "";
        if (!titleMatchesPositive(title) || titleMatchesNegative(title)) continue;

        const loc = job.location || "";
        const compMin = job.compensation?.min;
        const compMax = job.compensation?.max;
        const compStr =
          compMin && compMax
            ? `$${Math.round(compMin / 1000)}K-$${Math.round(compMax / 1000)}K`
            : "";

        results.push({
          title,
          company: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " "),
          url: normalizeUrl(
            `https://jobs.ashbyhq.com/${slug}/${job.id}`
          ),
          publishedDate: job.publishedAt || "",
          ...structuredLocationFields(loc, job.isRemote, job.workplaceType),
          source: "Tier 1: Ashby",
          comp: compStr,
          text: loc,
          highlights: "",
        });
      }
    } catch {
      failed.push(slug);
    }
  }

  return { results, failed, checked };
}

// ---------------------------------------------------------------------------
// Tier 1: Greenhouse API
// ---------------------------------------------------------------------------

async function scanGreenhouse(slugs) {
  const results = [];
  const failed = [];
  let checked = 0;

  for (const slug of slugs) {
    checked++;
    try {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
      );
      if (!res.ok) {
        if (res.status === 404) failed.push(slug);
        continue;
      }
      const data = await res.json();
      const jobs = data.jobs || [];

      for (const job of jobs) {
        const title = job.title || "";
        if (!titleMatchesPositive(title) || titleMatchesNegative(title)) continue;

        const loc = job.location?.name || "";

        results.push({
          title,
          company: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " "),
          url: normalizeUrl(job.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${job.id}`),
          publishedDate: job.updated_at || "",
          ...structuredLocationFields(loc, false, null),
          source: "Tier 1: Greenhouse",
          comp: "",
          text: loc,
          highlights: "",
        });
      }
    } catch {
      failed.push(slug);
    }
  }

  return { results, failed, checked };
}

// ---------------------------------------------------------------------------
// Tier 2 & 3: Exa neural search
// ---------------------------------------------------------------------------

async function exaSearch(query) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.error("ERROR: EXA_API_KEY not set. Add it to .env and retry.");
    process.exit(1);
  }

  const body = {
    query,
    type: "neural",
    numResults: 20,
    startPublishedDate: sevenDaysAgo(),
    excludeDomains: EXCLUDE_DOMAINS,
    contents: {
      text: { maxCharacters: 1500 },
      highlights: { maxCharacters: 500, query: "job title company location remote hybrid" },
    },
  };

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`  Exa error (${res.status}): ${errText.slice(0, 100)}`);
    return [];
  }

  const data = await res.json();
  return data.results || [];
}

// Deep search — slower but more thorough (agentic, query expansion)
async function exaDeepSearch(query) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return [];

  const body = {
    query,
    type: "auto",
    numResults: 15,
    startPublishedDate: sevenDaysAgo(),
    excludeDomains: EXCLUDE_DOMAINS,
    contents: {
      text: { maxCharacters: 2000 },
      highlights: { maxCharacters: 500, query: "job title company location salary remote" },
    },
  };

  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

// Similar search — "find me more like this URL"
async function exaSimilarSearch(url, numResults = 10) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return [];

  const body = {
    url,
    numResults,
    excludeDomains: EXCLUDE_DOMAINS,
    contents: {
      text: { maxCharacters: 1500 },
      highlights: { maxCharacters: 500, query: "job title company location" },
    },
  };

  try {
    const res = await fetch("https://api.exa.ai/findSimilar", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`  findSimilar error (${res.status}): ${err.slice(0, 80)}`);
      return [];
    }
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

// Company discovery search — find companies, not jobs
async function exaCompanySearch(query) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return [];

  const body = {
    query,
    type: "neural",
    category: "company",
    numResults: 10,
    contents: {
      text: { maxCharacters: 1000 },
      highlights: { maxCharacters: 300, query: "funding stage employees GTM revenue operations" },
    },
  };

  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

async function exaKeywordSearch(query) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.error("ERROR: EXA_API_KEY not set. Add it to .env and retry.");
    process.exit(1);
  }

  const body = {
    query,
    type: "keyword",
    numResults: 20,
    startPublishedDate: sevenDaysAgo(),
    excludeDomains: EXCLUDE_DOMAINS,
    contents: {
      text: { maxCharacters: 1500 },
      highlights: { maxCharacters: 500, query: "job title company location remote hybrid" },
    },
  };

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`  Exa keyword error (${res.status}): ${errText.slice(0, 100)}`);
    return [];
  }

  const data = await res.json();
  return data.results || [];
}

async function runExaQueries(queries, tierLabel) {
  const results = [];

  for (const query of queries) {
    process.stdout.write(`  ${query.slice(0, 65)}...`);
    try {
      const hits = await exaSearch(query);
      process.stdout.write(` ${hits.length}\n`);

      for (const r of hits) {
        const title = r.title || "";
        const url = normalizeUrl(r.url || "");
        const text = r.text || "";
        const highlights = (r.highlights || []).join(" ");

        results.push({
          title,
          company: extractCompany(title, url),
          url,
          publishedDate: r.publishedDate || "",
          ...locationFields(title, url, text + " " + highlights),
          source: tierLabel,
          comp: "",
          text,
          highlights,
        });
      }
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(roles, stats) {
  const date = today();
  let md = `# Job Scan — ${date}\n\n`;

  md += `## Source Summary\n\n`;
  md += `| Tier | Source | Companies/Queries | Matches | Errors |\n`;
  md += `|------|--------|-------------------|---------|--------|\n`;
  md += `| 1 | Ashby API | ${stats.ashby.checked} companies | ${stats.ashby.matches} | ${stats.ashby.failed.length} 404s |\n`;
  md += `| 1 | Greenhouse API | ${stats.greenhouse.checked} companies | ${stats.greenhouse.matches} | ${stats.greenhouse.failed.length} 404s |\n`;
  md += `| 1 | Lever API | ${stats.lever.checked} companies | ${stats.lever.matches} | ${stats.lever.failed.length} 404s |\n`;
  md += `| 2 | Exa broad | ${stats.exa.queries} queries | ${stats.exa.matches} | — |\n`;
  md += `| 3 | Exa VC portfolios | ${stats.vc.queries} queries | ${stats.vc.matches} | — |\n`;
  md += `| 3 | Exa HN/YC | ${stats.hn.queries} queries | ${stats.hn.matches} | — |\n`;
  md += `| 4 | GTM Engineers Club | ${stats.gtmClub.queries} queries | ${stats.gtmClub.matches} | — |\n`;
  md += `| 4 | RevOps Co-op | ${stats.revopsCoop.queries} queries | ${stats.revopsCoop.matches} | — |\n`;
  md += `| 5 | Social Signal | ${stats.social.queries} queries | ${stats.social.matches} | — |\n`;
  md += `| 6 | Similar Search | ${stats.similar.seeds} seeds | ${stats.similar.matches} | — |\n`;
  md += `| 7 | Hiring Intent | ${stats.intent.queries} queries | ${stats.intent.matches} | — |\n`;
  md += `| 8 | Deep Search | ${stats.deep.queries} queries | ${stats.deep.matches} | — |\n`;
  md += `| 9 | BuiltIn | ${stats.builtin.queries} queries | ${stats.builtin.matches} | — |\n`;
  md += `| 10 | YC Work at a Startup | ${stats.yc.queries} queries | ${stats.yc.matches} | — |\n`;
  md += `| 11 | VC Boards | ${stats.vcBoards.queries} queries | ${stats.vcBoards.matches} | — |\n`;
  md += `| 12 | Google-style | ${stats.google.queries} queries | ${stats.google.matches} | — |\n`;
  md += `| | **Total** | | **${roles.length} net-new** | |\n\n`;

  if (stats.ashby.failed.length > 0) {
    md += `**Ashby 404s:** ${stats.ashby.failed.join(", ")}  \n`;
  }
  if (stats.greenhouse.failed.length > 0) {
    md += `**Greenhouse 404s:** ${stats.greenhouse.failed.join(", ")}  \n`;
  }
  if (stats.lever.failed.length > 0) {
    md += `**Lever 404s:** ${stats.lever.failed.join(", ")}  \n`;
  }
  md += `\n---\n\n`;

  if (roles.length === 0) {
    md += `No net-new roles found. All results were duplicates or filtered out.\n`;
    return md;
  }

  // Group by score tier
  const tiers = [
    { label: "Top Picks (score 8+)", min: 8, max: 99 },
    { label: "Strong Match (score 6-7)", min: 6, max: 7 },
    { label: "Worth a Look (score 4-5)", min: 4, max: 5 },
    { label: "Below Criteria (score 1-3)", min: 1, max: 3 },
  ];

  for (const tier of tiers) {
    const group = roles.filter((r) => r.score >= tier.min && r.score <= tier.max);
    if (group.length === 0) continue;

    md += `## ${tier.label}\n\n`;

    if (tier.min <= 3) {
      // Compact list for low-scoring roles
      for (const r of group) {
        md += `- **${r.score}** | ${r.company} | ${r.roleTitle} | ${r.location} | ${r.source}\n`;
      }
      md += `\n`;
    } else {
      md += `| Score | Company | Role | Location | Source | Posted | Comp | Match |\n`;
      md += `|-------|---------|------|----------|--------|--------|------|-------|\n`;

      for (const r of group) {
        const posted = r.publishedDate ? r.publishedDate.slice(0, 10) : "—";
        md += `| **${r.score}** | ${r.company} | [${r.roleTitle}](${r.url}) | ${r.location} | ${r.source} | ${posted} | ${r.comp || "—"} | ${r.matchReason} |\n`;
      }
      md += `\n`;
    }
  }

  md += `---\n\n`;
  md += `*Generated by \`scripts/scan-jobs.mjs\` — Tier 1 (Ashby + Greenhouse APIs) + Tier 2 (Exa neural) + Tier 3 (VC + HN) + Tier 4 (GTM community boards) + Tier 5 (Social signals)*  \n`;
  md += `*Review roles above, then paste URLs into career-ops for full A-F evaluation.*\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Tier 9: BuiltIn — direct search scrape
// ---------------------------------------------------------------------------
// builtin.com/jobs?search=<q>&page=<n> is server-rendered: job cards are in the
// raw HTML. Its own search has far better recall than the Exa keyword search this
// replaced (Exa kept returning only literal-"GTM Engineer"-titled posts; BuiltIn's
// search surfaces "GTM Engineering Manager", "Head of GTM Systems and Engineering",
// "Engineering Manager, GTM Engineering", etc.).

const BUILTIN_BASE = "https://builtin.com";
const BUILTIN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Results are recency-sorted; a niche query ("GTM Engineering") returns everything on
// page 1, and a broad query's deeper pages are mostly stale. 2 pages is plenty.
const BUILTIN_MAX_PAGES = 2;

// Decode the HTML entities that show up in BuiltIn job titles (&amp;, &#x2013; en-dash,
// &#39; apostrophe, …). BuiltIn also HTML-escapes some attributes oddly, so handle numeric
// entities generically.
function htmlDecode(s) {
  return (s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; } })
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}
const clean = (s) => htmlDecode((s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// "Reposted 16 Days Ago" / "20 Days Ago" / "Reposted 2 Days Ago" -> ISO date (today - N).
function builtinPostedToDate(s) {
  const m = (s || "").match(/(\d+)\s+(hour|day|week|month)s?\s+ago/i);
  if (!m) return "";
  const mult = { hour: 0, day: 1, week: 7, month: 30 }[m[2].toLowerCase()] ?? 0;
  const d = new Date();
  d.setDate(d.getDate() - parseInt(m[1], 10) * mult);
  return d.toISOString().slice(0, 10);
}

// Pull a job-card attribute. Cards key each attribute by an adjacent FontAwesome icon
// class (fa-clock = posted date, fa-house-building = workplace type, fa-location-dot =
// location, fa-trophy = seniority, fa-sack-dollar = comp). Two layouts: clock has the
// text immediately after the icon's </i>; the rest have the icon in a sibling div before
// a <span> holding the text.
function builtinCardAttr(cardHtml, faIcon) {
  const idx = cardHtml.search(new RegExp(`fa-${faIcon}\\b`, "i"));
  if (idx === -1) return "";
  const after = cardHtml.slice(idx, idx + 600);
  const m1 = after.match(/<\/i>\s*([^<\s][^<]*)</); // text right after the icon
  if (m1) return clean(m1[1]);
  const m2 = after.match(/<span[^>]*>([\s\S]*?)<\/span>/); // first <span> after the icon
  if (m2) return clean(m2[1]);
  return "";
}

async function scanBuiltIn() {
  const results = [];
  for (const query of BUILTIN_SEARCHES) {
    process.stdout.write(`  ${query.padEnd(28)}...`);
    let matched = 0;
    try {
      for (let page = 1; page <= BUILTIN_MAX_PAGES; page++) {
        const url = `${BUILTIN_BASE}/jobs?search=${encodeURIComponent(query)}&page=${page}`;
        const res = await fetch(url, {
          headers: { "User-Agent": BUILTIN_UA, Accept: "text/html" },
          signal: AbortSignal.timeout(15000),
          redirect: "follow",
        });
        if (!res.ok) {
          process.stdout.write(` HTTP ${res.status}`);
          break;
        }
        const html = await res.text();
        // Each job card container has `data-id="job-card"` (the title anchor's longer
        // `data-id="job-card-title"` is not a substring of it, so this split is safe).
        const cards = html.split('data-id="job-card"').slice(1);
        if (cards.length === 0) break;
        for (const chunk of cards) {
          // <a href="/job/{slug}/{id}" … data-id="job-card-title" …>Title</a> (attr order varies)
          const titleM = chunk.match(/<a ([^>]*\bdata-id="job-card-title"[^>]*)>([^<]+)<\/a>/i);
          if (!titleM) continue;
          const hrefM = titleM[1].match(/href="(\/job\/[^"]+)"/i);
          if (!hrefM) continue;
          const href = hrefM[1];
          const title = clean(titleM[2]);
          if (!titleMatchesPositive(title) || titleMatchesNegative(title)) continue;
          const seniority = builtinCardAttr(chunk, "trophy");
          if (/internship/i.test(seniority)) continue; // catch interns the title missed
          // <a … data-id="company-title" …><span>Company</span></a>
          const coM = chunk.match(/<a [^>]*\bdata-id="company-title"[^>]*>([\s\S]*?)<\/a>/i);
          const company = coM ? clean(coM[1]) : "";
          const workplace = builtinCardAttr(chunk, "house-building"); // Hybrid / Remote or Hybrid / In-Office / Remote
          const locStr = builtinCardAttr(chunk, "location-dot"); // "New York, NY, USA" / "4 Locations"
          results.push({
            title,
            company: company || extractCompany(title, BUILTIN_BASE + href),
            url: normalizeUrl(BUILTIN_BASE + href),
            publishedDate: builtinPostedToDate(builtinCardAttr(chunk, "clock")),
            ...locationFields(`${title} ${workplace} ${locStr}`, BUILTIN_BASE + href, `${workplace} ${locStr}`),
            source: "BuiltIn",
            comp: builtinCardAttr(chunk, "sack-dollar"), // "91K-137K Annually" (often absent)
            text: "",
            highlights: "",
          });
          matched++;
        }
        // BuiltIn pages 25 results; fewer than that or no "next" link -> last page.
        if (cards.length < 25 || !/aria-label="Go to Next Page"/i.test(html)) break;
      }
      process.stdout.write(` ${matched}\n`);
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== Job Scan — ${today()} ===\n`);

  const seen = loadSeen();
  const companies = loadCompanies();
  const allTrackedSlugs = [
    ...companies.ashby,
    ...companies.greenhouse,
    ...companies.lever,
  ];

  const stats = {
    ashby: { checked: 0, matches: 0, failed: [] },
    greenhouse: { checked: 0, matches: 0, failed: [] },
    lever: { checked: 0, matches: 0, failed: [] },
    exa: { queries: EXA_QUERIES.length, matches: 0 },
    vc: { queries: VC_QUERIES.length, matches: 0 },
    hn: { queries: HN_QUERIES.length, matches: 0 },
    gtmClub: { queries: GTM_CLUB_QUERIES.length, matches: 0 },
    revopsCoop: { queries: REVOPS_COOP_QUERIES.length, matches: 0 },
    social: { queries: SOCIAL_QUERIES.length, matches: 0 },
    similar: { seeds: 0, matches: 0 },
    intent: { queries: INTENT_QUERIES.length, matches: 0 },
    deep: { queries: 3, matches: 0 },
    builtin: { queries: BUILTIN_SEARCHES.length, matches: 0 },
    yc: { queries: YC_SEARCHES.length, matches: 0 },
    vcBoards: { queries: VC_BOARD_CONFIGS.length * VC_BOARD_SEARCHES.length, matches: 0 },
    google: { queries: GOOGLE_QUERIES.length, matches: 0 },
  };

  const allResults = [];

  // --- Tier 1: Ashby ---
  console.log(`[Tier 1] Ashby API — ${companies.ashby.length} companies`);
  const ashby = await scanAshby(companies.ashby);
  stats.ashby.checked = ashby.checked;
  stats.ashby.failed = ashby.failed;
  stats.ashby.matches = ashby.results.length;
  allResults.push(...ashby.results);
  console.log(`  Found ${ashby.results.length} matching roles (${ashby.failed.length} 404s)\n`);

  // --- Tier 1: Greenhouse ---
  console.log(`[Tier 1] Greenhouse API — ${companies.greenhouse.length} companies`);
  const gh = await scanGreenhouse(companies.greenhouse);
  stats.greenhouse.checked = gh.checked;
  stats.greenhouse.failed = gh.failed;
  stats.greenhouse.matches = gh.results.length;
  allResults.push(...gh.results);
  console.log(`  Found ${gh.results.length} matching roles (${gh.failed.length} 404s)\n`);

  // --- Tier 1: Lever ---
  // Lever is structurally identical to Ashby/Greenhouse — public per-company API,
  // no auth. Per autoapply/SCRAPER_AUDIT.md surprise finding: zero Lever URLs in
  // 1,251 seen-urls, despite Lever hosting Plaid, PostHog, Pinecone, Modal Labs,
  // and others squarely in our ICP. Title filtering done downstream in the same
  // dedup+filter pass as Ashby/GH (Tier-1 results are flagged "Tier 1: Lever" and
  // get the same shortcut treatment as the other two).
  console.log(`[Tier 1] Lever API — ${companies.lever.length} companies`);
  const lever = await scanLever(companies.lever);
  stats.lever.checked = lever.checked;
  stats.lever.failed = lever.failed;
  // scanLever returns ALL postings; apply the same title gate Ashby/GH apply inline.
  const leverFiltered = lever.results.filter(
    (r) => titleMatchesPositive(r.title) && !titleMatchesNegative(r.title),
  );
  stats.lever.matches = leverFiltered.length;
  allResults.push(...leverFiltered);
  console.log(
    `  Found ${leverFiltered.length} matching roles (${lever.failed.length} 404s, ${lever.results.length} total before title filter)\n`,
  );

  // --- Tier 2: Exa broad ---
  console.log(`[Tier 2] Exa neural search — ${EXA_QUERIES.length} queries`);
  const exaResults = await runExaQueries(EXA_QUERIES, "Tier 2: Exa");
  stats.exa.matches = exaResults.length;
  allResults.push(...exaResults);
  console.log(`  Total Exa broad: ${exaResults.length}\n`);

  // --- Tier 3: VC portfolio ---
  console.log(`[Tier 3] VC portfolio queries — ${VC_QUERIES.length} queries`);
  const vcResults = await runExaQueries(VC_QUERIES, "Tier 3: VC");
  stats.vc.matches = vcResults.length;
  allResults.push(...vcResults);
  console.log(`  Total VC: ${vcResults.length}\n`);

  // --- Tier 3: HN/YC ---
  console.log(`[Tier 3] HN/YC queries — ${HN_QUERIES.length} queries`);
  const hnResults = await runExaQueries(HN_QUERIES, "Tier 3: HN");
  stats.hn.matches = hnResults.length;
  allResults.push(...hnResults);
  console.log(`  Total HN/YC: ${hnResults.length}\n`);

  // --- Tier 4: GTM Engineers Club ---
  console.log(`[Tier 4] GTM Engineers Club — ${GTM_CLUB_QUERIES.length} queries`);
  const gtmClubResults = await runExaQueries(GTM_CLUB_QUERIES, "GTM Engineers Club");
  stats.gtmClub.matches = gtmClubResults.length;
  allResults.push(...gtmClubResults);
  console.log(`  Total GTM Engineers Club: ${gtmClubResults.length}\n`);

  // --- Tier 4: RevOps Co-op ---
  console.log(`[Tier 4] RevOps Co-op — ${REVOPS_COOP_QUERIES.length} queries`);
  const revopsCoopResults = await runExaQueries(REVOPS_COOP_QUERIES, "RevOps Co-op");
  stats.revopsCoop.matches = revopsCoopResults.length;
  allResults.push(...revopsCoopResults);
  console.log(`  Total RevOps Co-op: ${revopsCoopResults.length}\n`);

  // --- Tier 5: Social signals ---
  console.log(`[Tier 5] Social signals — ${SOCIAL_QUERIES.length} queries`);
  const socialResults = await runExaQueries(SOCIAL_QUERIES, "Social Signal");
  stats.social.matches = socialResults.length;
  allResults.push(...socialResults);
  console.log(`  Total Social signals: ${socialResults.length}\n`);

  // --- Tier 6: Similar search (find more like your best roles) ---
  // Use top-scoring Tier 1 roles as seeds for "find similar"
  const tier1Urls = allResults
    .filter((r) => r.source.startsWith("Tier 1"))
    .map((r) => r.url);
  // Also use previously actioned roles from applications.md
  const appPath = join(ROOT, "data", "applications.md");
  if (existsSync(appPath)) {
    const appContent = readFileSync(appPath, "utf-8");
    const urlMatches = appContent.match(/https:\/\/[^\s|)]+/g) || [];
    tier1Urls.push(...urlMatches);
  }
  // Pick up to 5 seed URLs for similar search
  const seedUrls = [...new Set(tier1Urls)].slice(0, 5);
  console.log(`[Tier 6] Similar search — ${seedUrls.length} seed URLs`);
  const similarResults = [];
  for (const seedUrl of seedUrls) {
    process.stdout.write(`  Similar to: ${seedUrl.slice(0, 65)}...`);
    try {
      const hits = await exaSimilarSearch(seedUrl, 8);
      process.stdout.write(` ${hits.length}\n`);
      for (const r of hits) {
        similarResults.push({
          title: r.title || "",
          company: extractCompany(r.title || "", normalizeUrl(r.url || "")),
          url: normalizeUrl(r.url || ""),
          publishedDate: r.publishedDate || "",
          ...locationFields(r.title || "", r.url || "", (r.text || "") + " " + ((r.highlights || []).join(" "))),
          source: "Tier 6: Similar",
          comp: "",
          text: r.text || "",
          highlights: (r.highlights || []).join(" "),
        });
      }
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
    }
  }
  allResults.push(...similarResults);
  console.log(`  Total similar: ${similarResults.length}\n`);

  // --- Tier 7: Hiring intent signals ---
  console.log(`[Tier 7] Hiring intent — ${INTENT_QUERIES.length} queries`);
  const intentResults = await runExaQueries(INTENT_QUERIES, "Tier 7: Intent");
  allResults.push(...intentResults);
  console.log(`  Total intent: ${intentResults.length}\n`);

  // --- Tier 8: Deep search on primary archetypes ---
  const DEEP_QUERIES = [
    "GTM Engineer building revenue infrastructure at a high-growth AI startup",
    "Revenue Operations lead designing the GTM stack from scratch at a Series B company",
    "Go-to-market engineer role with Clay Python Salesforce automation and AI workflows",
  ];
  console.log(`[Tier 8] Deep search — ${DEEP_QUERIES.length} queries`);
  const deepResults = [];
  for (const query of DEEP_QUERIES) {
    process.stdout.write(`  ${query.slice(0, 65)}...`);
    try {
      const hits = await exaDeepSearch(query);
      process.stdout.write(` ${hits.length}\n`);
      for (const r of hits) {
        deepResults.push({
          title: r.title || "",
          company: extractCompany(r.title || "", normalizeUrl(r.url || "")),
          url: normalizeUrl(r.url || ""),
          publishedDate: r.publishedDate || "",
          ...locationFields(r.title || "", r.url || "", (r.text || "") + " " + ((r.highlights || []).join(" "))),
          source: "Tier 8: Deep",
          comp: "",
          text: r.text || "",
          highlights: (r.highlights || []).join(" "),
        });
      }
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
    }
  }
  allResults.push(...deepResults);
  console.log(`  Total deep: ${deepResults.length}\n`);

  // --- Tier 9: BuiltIn — direct search scrape (builtin.com/jobs?search=…) ---
  console.log(`[Tier 9] BuiltIn — ${BUILTIN_SEARCHES.length} searches (direct scrape)`);
  const builtinResults = await scanBuiltIn();
  stats.builtin.matches = builtinResults.length;
  allResults.push(...builtinResults);
  console.log(`  Total BuiltIn: ${builtinResults.length}\n`);

  // --- Helper: run keyword search on a specific domain set ---
  async function scanDomainSource(sourceName, domains, searches) {
    const results = [];
    for (const query of searches) {
      process.stdout.write(`  ${query.padEnd(25)}...`);
      try {
        const apiKey = process.env.EXA_API_KEY;
        const res = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            type: "keyword",
            numResults: 20,
            includeDomains: domains,
            contents: { text: { maxCharacters: 600 } },
          }),
        });
        if (!res.ok) {
          process.stdout.write(` Exa error ${res.status}\n`);
          continue;
        }
        const data = await res.json();
        const hits = data.results || [];
        process.stdout.write(` ${hits.length}\n`);

        for (const r of hits) {
          const rawTitle = r.title || "";
          const url = normalizeUrl(r.url || "");
          const text = r.text || "";

          // Clean common suffixes from title
          const cleanedTitle = rawTitle
            .replace(/\s*[|]\s*(?:Y Combinator|8VC|Built In|VentureLoop|Greylock|Insight Partners|General Catalyst).*$/i, "")
            .replace(/\s*-\s*(?:8VC Job Board|VentureLoop|Greylock).*$/i, "")
            .trim();

          // Extract company from "Role at Company" or "Company - Role" patterns
          let company = "";
          let roleTitle = cleanedTitle;

          // Pattern: "Role at Company | Source"
          const atMatch = cleanedTitle.match(/^(.+?)\s+at\s+(.+?)$/i);
          if (atMatch) {
            roleTitle = atMatch[1].trim();
            company = atMatch[2].trim();
          } else {
            // Pattern: "Role @ Company" or "Company - Role"
            const parts = cleanedTitle.split(/\s*[-–—@]\s*/);
            if (parts.length >= 2) {
              const firstLower = parts[0].toLowerCase();
              if (/gtm|revenue|revops|sales|go-to-market|head|director|senior|manager|vp/.test(firstLower)) {
                company = parts[parts.length - 1].trim();
                roleTitle = parts.slice(0, -1).join(" - ").trim();
              } else {
                company = parts[0].trim();
                roleTitle = parts.slice(1).join(" - ").trim();
              }
            }
          }

          // Clean company name — strip "@ " prefix, aggregator suffixes, and job board names
          company = company
            .replace(/^@\s*/, "")
            .replace(/\s*\(.*?\)\s*$/, "")
            .replace(/\s*Job Board\s*$/i, "")
            .trim();

          // If company is the VC board name, try to extract real company from title suffix
          // e.g., "GTM Engineer - Heron Data" where company was extracted as "Insight Partners Job Board"
          if (/^(General Catalyst|Insight Partners|8VC|Greylock|Sequoia)$/i.test(company)) {
            const suffixMatch = roleTitle.match(/\s*[-–—]\s*([A-Z][A-Za-z0-9. ]+?)$/);
            if (suffixMatch) {
              company = suffixMatch[1].trim();
              roleTitle = roleTitle.replace(suffixMatch[0], "").trim();
            }
          }

          results.push({
            title: roleTitle || cleanedTitle,
            company: company || extractCompany(cleanedTitle, url),
            url,
            publishedDate: r.publishedDate || "",
            ...locationFields(cleanedTitle, url, text),
            source: sourceName,
            comp: "",
            text,
            highlights: "",
          });
        }
      } catch (err) {
        process.stdout.write(` ERROR: ${err.message}\n`);
      }
    }
    return results;
  }

  // --- Tier 10: YC Work at a Startup ---
  console.log(`[Tier 10] YC Work at a Startup — ${YC_SEARCHES.length} searches`);
  const ycResults = await scanDomainSource("YC", YC_DOMAINS, YC_SEARCHES);
  stats.yc.matches = ycResults.length;
  allResults.push(...ycResults);
  console.log(`  Total YC: ${ycResults.length}\n`);

  // --- Tier 11: VC portfolio boards ---
  let vcBoardTotal = 0;
  for (const board of VC_BOARD_CONFIGS) {
    console.log(`[Tier 11] ${board.name} — ${VC_BOARD_SEARCHES.length} searches`);
    const boardResults = await scanDomainSource(board.name, board.domains, VC_BOARD_SEARCHES);
    vcBoardTotal += boardResults.length;
    allResults.push(...boardResults);
    console.log(`  Total ${board.name}: ${boardResults.length}\n`);
  }
  stats.vcBoards.matches = vcBoardTotal;

  // --- Tier 12: Google-style keyword search (exact phrase matching) ---
  console.log(`[Tier 12] Google-style keyword — ${GOOGLE_QUERIES.length} queries`);
  const googleResults = [];
  for (const query of GOOGLE_QUERIES) {
    process.stdout.write(`  ${query.slice(0, 65)}...`);
    try {
      const hits = await exaKeywordSearch(query);
      process.stdout.write(` ${hits.length}\n`);
      for (const r of hits) {
        const title = r.title || "";
        const url = normalizeUrl(r.url || "");
        const text = r.text || "";
        const highlights = (r.highlights || []).join(" ");
        googleResults.push({
          title,
          company: extractCompany(title, url),
          url,
          publishedDate: r.publishedDate || "",
          ...locationFields(title, url, text + " " + highlights),
          source: "Google Search",
          comp: "",
          text,
          highlights,
        });
      }
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
    }
  }
  stats.google.matches = googleResults.length;
  allResults.push(...googleResults);
  console.log(`  Total Google-style: ${googleResults.length}\n`);

  // --- Deduplicate ---
  console.log(`--- Processing ---`);
  console.log(`  Raw results: ${allResults.length}`);

  const uniqueByUrl = new Map();
  for (const r of allResults) {
    // Prefer Tier 1 sources over Tier 2/3 if duplicate
    if (!uniqueByUrl.has(r.url) || r.source.startsWith("Tier 1")) {
      uniqueByUrl.set(r.url, r);
    }
  }
  console.log(`  After URL dedup: ${uniqueByUrl.size}`);

  // Filter non-job content (blogs, newsletters, articles)
  let contentSkipped = 0;
  for (const [url, r] of uniqueByUrl) {
    if (!r.source.startsWith("Tier 1") && isNonJobContent(r.title, url)) {
      uniqueByUrl.delete(url);
      contentSkipped++;
    }
  }
  console.log(`  After content filter: ${uniqueByUrl.size} (skipped ${contentSkipped} non-job)`);

  // Filter by title (Tier 1 already filtered, but Exa results need it)
  const filtered = [];
  let titleSkipped = 0;
  for (const r of uniqueByUrl.values()) {
    if (r.source.startsWith("Tier 1")) {
      // Already filtered during API scan
      filtered.push(r);
      continue;
    }
    if (titleMatchesNegative(r.title)) {
      titleSkipped++;
      continue;
    }
    if (!titleMatchesPositive(r.title) && !titleMatchesPositive(r.highlights || "")) {
      titleSkipped++;
      continue;
    }
    filtered.push(r);
  }
  console.log(`  After title filter: ${filtered.length} (skipped ${titleSkipped})`);

  // Deduplicate against seen URLs
  const netNew = [];
  for (const r of filtered) {
    if (seen[r.url]) continue;
    netNew.push(r);
  }
  console.log(`  Net-new candidates: ${netNew.length}`);

  // --- Validation pipeline ---
  console.log(`\n--- Validation ---`);

  // STEP 1: Resolve companies for entries that don't have one
  let resolved = 0;
  let resolveAttempts = 0;
  const NEEDS_RESOLUTION = ["YC"]; // BuiltIn now arrives with company resolved (Tier 9 direct scrape)
  for (const r of netNew) {
    // Clean up display fields first
    if (!r.location) {
      Object.assign(r, locationFields(r.title, r.url, r.text + " " + (r.highlights || "")));
    }
    r.roleTitle = r.source.startsWith("Tier 1") ? r.title : extractRoleTitle(r.title);
    if (r.company === "—" || !r.company) {
      r.company = r.source.startsWith("Tier 1") ? r.company : extractCompany(r.title, r.url);
    }

    // If company is still missing and source supports resolution, fetch the page
    if ((!r.company || r.company === "—" || r.company === "Unknown") &&
        (NEEDS_RESOLUTION.includes(r.source) || r.url.includes("workatastartup.com"))) {
      resolveAttempts++;
      try {
        const res = await fetch(r.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; career-ops/1.0)" },
          signal: AbortSignal.timeout(6000),
          redirect: "follow",
        });
        if (res.ok) {
          const html = await res.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const pageTitle = titleMatch ? titleMatch[1].trim() : "";

          if (r.url.includes("workatastartup.com") && pageTitle) {
            const atMatch = pageTitle.match(/\bat\s+(.+?)\s*(?:\||$)/i);
            if (atMatch) r.company = atMatch[1].trim();
          }

          if (r.company && r.company !== "—") resolved++;
        }
      } catch {
        // Timeout or network error — skip silently
      }
    }
  }
  if (resolveAttempts > 0) {
    console.log(`  Company resolution: ${resolved}/${resolveAttempts} resolved`);
  }

  // STEP 2: Reject entries without a company name
  const withCompany = [];
  let noCompanySkipped = 0;
  for (const r of netNew) {
    if (!r.company || r.company === "—" || r.company === "Unknown") {
      noCompanySkipped++;
      continue;
    }
    withCompany.push(r);
  }
  if (noCompanySkipped > 0) {
    console.log(`  Rejected (no company): ${noCompanySkipped}`);
  }

  // STEP 2b: Title cleanup — strip source-attribution suffixes ("| Built In NYC",
  // "| LinkedIn", " at <Company>") *before* the cross-company dedup so the
  // dedup keys are computed on the canonical role title. Without this, two
  // identical roles scraped from different aggregators (e.g. one direct Built
  // In page and one Exa-syndicated copy) survive dedup as separate entries.
  let titlesCleaned = 0;
  for (const r of withCompany) {
    const before = r.title;
    const cleaned = cleanTitle(r.title, { company: r.company });
    if (cleaned && cleaned !== before) {
      r.title = cleaned;
      titlesCleaned++;
    }
    // r.roleTitle was extracted earlier from the *raw* title. Re-clean it too
    // so any source-attribution residue gets removed for dedup keying.
    if (r.roleTitle) {
      const rtCleaned = cleanTitle(r.roleTitle, { company: r.company });
      if (rtCleaned) r.roleTitle = rtCleaned;
    }
  }
  if (titlesCleaned > 0) {
    console.log(`  Title cleanup: ${titlesCleaned} titles stripped of source-attribution suffixes`);
  }

  // STEP 3: Cross-company dedup — skip if same company + similar role already in pipeline.
  // Uses shared companyKey() so aliased names (OpenAI Inc / OpenAI, X / xAI, etc.)
  // collapse to the same bucket — see scripts/lib/normalize-company.mjs.
  const companyRoleIndex = new Map();
  // Build index from existing seen URLs
  for (const [, meta] of Object.entries(seen)) {
    if (!meta.company) continue;
    const coKey = companyKey(meta.company);
    const titleKey = (meta.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (coKey.length >= 3) {
      if (!companyRoleIndex.has(coKey)) companyRoleIndex.set(coKey, new Set());
      companyRoleIndex.get(coKey).add(titleKey);
    }
  }

  const dedupedNew = [];
  let crossDeduped = 0;
  for (const r of withCompany) {
    const coKey = companyKey(r.company);
    const titleKey = (r.roleTitle || r.title).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

    if (coKey.length >= 3 && companyRoleIndex.has(coKey)) {
      const existingTitles = companyRoleIndex.get(coKey);
      // Check for similar title (exact match or one contains the other)
      let isDupe = false;
      for (const existing of existingTitles) {
        if (existing === titleKey || existing.includes(titleKey) || titleKey.includes(existing)) {
          isDupe = true;
          break;
        }
      }
      if (isDupe) {
        crossDeduped++;
        continue;
      }
    }

    // Add to index
    if (coKey.length >= 3) {
      if (!companyRoleIndex.has(coKey)) companyRoleIndex.set(coKey, new Set());
      companyRoleIndex.get(coKey).add(titleKey);
    }
    dedupedNew.push(r);
  }
  if (crossDeduped > 0) {
    console.log(`  Cross-company dedup: ${crossDeduped} duplicates removed`);
  }

  // STEP 4: Score — cap at 7 pre-enrichment, let enrichment raise it
  for (const r of dedupedNew) {
    r.score = autoScore(r.roleTitle, r.company, r.location, allTrackedSlugs);

    // Pre-enrichment cap: no role scores above 7 until Claude confirms fit
    // Exception: Tier 1 (Ashby/Greenhouse) roles at tracked companies
    if (!r.source.startsWith("Tier 1")) {
      r.score = Math.min(r.score, 7);
    }

    // Match reason
    const matchedAnchor = titleMatchAnchor(r.title) || titleMatchAnchor(r.highlights || "");
    r.matchReason = matchedAnchor ? `"${matchedAnchor}"` : "query relevance";
  }

  // STEP 5: Write validated entries to seen-urls
  for (const r of dedupedNew) {
    const tier = classifySourceTier(r.url);
    seen[r.url] = {
      firstSeen: today(),
      title: r.title,
      source: r.source,
      company: r.company,
      location: r.location || "Unknown",
      ...(r.location_workplace ? {
        location_workplace: r.location_workplace,
        location_city: r.location_city ?? null,
        location_region: r.location_region ?? null,
      } : {}),
      ...(tier ? { source_tier: tier } : {}),
    };
  }

  console.log(`  Validated net-new: ${dedupedNew.length}`);

  // --- Auto-promotion: BuiltIn / YC discovery → direct ATS tracking ---
  // For each new role whose URL is already a recognized ATS endpoint AND whose
  // source channel is a promotable aggregator (BuiltIn, YC), add the company to
  // config/companies.yml so future scans hit it via Tier 1. Capped at
  // PROMOTION_CAP_PER_RUN to defend against pathological inputs.
  //
  // The BuiltIn→ATS redirect-resolution case (a builtin.com URL whose apply form
  // lives on Ashby/GH/Lever — the audit's textbook example) is handled at enrich
  // time by enrich-roles.mjs; this scan-time pass catches the cases where the
  // discovered URL is *already* an ATS URL (Tier 6 Similar surfacing
  // jobs.ashbyhq.com URLs adjacent to BuiltIn discoveries, etc.).
  const promotionRunState = createPromotionRunState();
  const PROMOTABLE_SOURCE_HOSTS = {
    BuiltIn: "builtin.com",
    "Tier 6: Similar": null, // host varies — set per-role from r.url
    YC: "workatastartup.com",
  };
  let promotedCount = 0;
  for (const r of dedupedNew) {
    if (!r || !r.url || !r.source) continue;
    // Only consider promotable sources. For Tier 6: Similar, we need a notion of
    // a "discovery channel" — use builtin.com when the seed was a Tier-1/BuiltIn
    // role (we don't track the seed per result here; conservative skip).
    if (!Object.prototype.hasOwnProperty.call(PROMOTABLE_SOURCE_HOSTS, r.source)) continue;
    const sourceHost = PROMOTABLE_SOURCE_HOSTS[r.source];
    if (!sourceHost) continue;

    const result = processRolePromotion({
      url: r.url,
      sourceHost,
      canonicalName: r.company,
      fitScore: undefined, // fit is only known post-enrichment; rely on minFitScore default
      existingCompanies: companies.all,
      runState: promotionRunState,
      minFitScore: 0, // pre-enrichment we don't know fit; skip the gate
    });
    if (result.action === "promoted") {
      promotedCount++;
      console.log(
        `  AUTO-PROMOTED: ${result.entry.canonical_name} → ${result.entry.ats}/${result.entry.slug} (from ${sourceHost})`,
      );
    }
  }
  if (promotionRunState.capped) {
    console.log(
      `  WARNING: hit per-run auto-promotion cap (${PROMOTION_CAP_PER_RUN}); further candidates were skipped this run.`,
    );
  }
  if (promotedCount > 0) {
    console.log(`  Promoted ${promotedCount} new companies into config/companies.yml.`);
  }

  // Use dedupedNew as the final list for reporting
  const validatedNew = dedupedNew;

  // Sort: score descending, then location priority within same score
  validatedNew.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const locA = a.location.includes("NYC") ? 0 : a.location.includes("Hybrid") ? 1 : a.location.includes("Remote") ? 2 : 3;
    const locB = b.location.includes("NYC") ? 0 : b.location.includes("Hybrid") ? 1 : b.location.includes("Remote") ? 2 : 3;
    return locA - locB;
  });

  // --- Generate report ---
  const md = generateReport(validatedNew, stats);
  const date = today();
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = join(REPORTS_DIR, `job-scan-${date}.md`);
  writeFileSync(reportPath, md);
  console.log(`\n  Report saved: reports/job-scan-${date}.md`);

  saveSeen(seen);
  console.log(`  Seen URLs: ${Object.keys(seen).length} total\n`);

  // --- Summary ---
  if (validatedNew.length > 0) {
    const topPicks = validatedNew.filter((r) => r.score >= 8);
    const strong = validatedNew.filter((r) => r.score >= 6 && r.score <= 7);

    if (topPicks.length > 0) {
      console.log(`  Top Picks (${topPicks.length}):`);
      for (const r of topPicks) {
        console.log(`    [${r.score}] ${r.company.padEnd(18)} ${r.roleTitle.slice(0, 45).padEnd(45)} ${r.location.padEnd(12)} ${r.source}`);
      }
    }
    if (strong.length > 0) {
      console.log(`\n  Strong Match (${strong.length}):`);
      for (const r of strong) {
        console.log(`    [${r.score}] ${r.company.padEnd(18)} ${r.roleTitle.slice(0, 45).padEnd(45)} ${r.location.padEnd(12)} ${r.source}`);
      }
    }

    console.log(`\n  → Full report: reports/job-scan-${date}.md`);
    console.log(`  → Evaluate top picks: paste URLs into /career-ops\n`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
