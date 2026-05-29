#!/usr/bin/env node

/**
 * scan-signals.mjs — Pre-posting signal detection for career-ops
 *
 * Finds companies that will need a GTM Engineer in the next 30-60 days
 * BEFORE they post the role, by detecting funding signals and checking
 * for the absence of relevant job postings.
 *
 * Layer 1: Funding discovery via Exa neural search
 * Layer 2: Absence check + leadership confirmation (combined query)
 * Output:  High Conviction / Monitor / Already Posting
 *
 * Usage:
 *   node scripts/scan-signals.mjs
 *   npm run scan-signals
 *
 * Cron (weekly Monday 7am ET):
 *   0 7 * * 1 cd ~/projects/job-search/nick-career-ops && npm run scan-signals >> /tmp/scan-signals.log 2>&1
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Config
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

const SIGNAL_SEEN_PATH = join(ROOT, "data", "signal-seen.json");
const REPORTS_DIR = join(ROOT, "reports");
const PIPELINE_PATH = join(ROOT, "data", "pipeline.md");

// How many days before we recheck a company
const RECHECK_DAYS = 14;

// Delay between Exa calls (ms) to respect rate limits
const QUERY_DELAY_MS = 300;

// Exa spam domains: canonical list from ./lib/source-classification.mjs
// (config/source-classification.json). The old scan-signals.mjs copy was a 12-entry
// subset, missing the post-2026-05 additions — importing closes that drift.
import { EXCLUDE_DOMAINS } from "./lib/source-classification.mjs";
import { createProgress } from "./lib/progress.mjs";

// Crypto/web3 keywords — skip unless big raise
const CRYPTO_KEYWORDS = [
  "crypto", "web3", "blockchain", "defi", "nft", "token",
  "decentralized", "dao", "dapp",
];

// ICP filter: sectors that match Nick's target profile
const ICP_POSITIVE_SECTORS = [
  "saas", "b2b", "ai", "artificial intelligence", "machine learning",
  "developer tools", "devtools", "infrastructure", "fintech",
  "automation", "data", "analytics", "cloud", "api", "platform",
  "software", "enterprise software", "martech", "revtech",
];

// Sectors that are poor ICP fit — skip unless very strong signal
const ICP_NEGATIVE_SECTORS = [
  "healthcare", "biotech", "pharma", "clinical", "medical device",
  "consumer", "d2c", "e-commerce", "retail", "food", "restaurant",
  "real estate", "construction", "manufacturing", "logistics",
  "education", "edtech", "government", "defense", "military",
  "insurance", "staffing", "recruiting", "agency", "consulting",
  "gaming", "entertainment", "media", "publishing", "news",
  "nonprofit", "charity", "social impact",
];

// ---------------------------------------------------------------------------
// Layer 1: Funding discovery queries
// ---------------------------------------------------------------------------

const FUNDING_QUERIES = [
  'B2B SaaS company raises Series B funding 2026 announces round',
  'AI startup closes Series C round 2026 announces funding',
  'Series B funding announced 2026 fintech SaaS company',
  'AI infrastructure B2B company raises funding 2026 venture round',
  'raises Series B 2026 AI developer tools infrastructure',
  'Series B Series C 2026 revenue operations GTM SaaS',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadSignalSeen() {
  if (!existsSync(SIGNAL_SEEN_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SIGNAL_SEEN_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveSignalSeen(seen) {
  const dir = dirname(SIGNAL_SEEN_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SIGNAL_SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
}

function loadTrackedCompanies() {
  const configPath = join(ROOT, "config", "companies.yml");
  if (!existsSync(configPath)) return new Set();
  const raw = readFileSync(configPath, "utf-8");
  const slugs = [...raw.matchAll(/^\s*-\s*([a-z0-9-]+)/gm)].map((m) => m[1]);
  return new Set(slugs.map((s) => s.toLowerCase().replace(/-/g, "")));
}

function shouldRecheck(entry) {
  if (!entry || !entry.lastChecked) return true;
  const lastChecked = new Date(entry.lastChecked);
  const now = new Date();
  const daysSince = (now - lastChecked) / (1000 * 60 * 60 * 24);
  return daysSince >= RECHECK_DAYS;
}

function isCryptoCompany(text) {
  const lower = text.toLowerCase();
  return CRYPTO_KEYWORDS.some((kw) => lower.includes(kw));
}

// News/press domains — not useful as company domains
const NEWS_DOMAINS = new Set([
  "prnewswire.com", "globenewswire.com", "businesswire.com", "techcrunch.com",
  "bloomberg.com", "reuters.com", "cnbc.com", "forbes.com", "venturebeat.com",
  "theinformation.com", "sifted.eu", "intelligence360.news", "thesaasnews.com",
  "martechseries.com", "techcompanynews.com", "vcaonline.com", "vctavern.com",
  "disrupts.com", "ventureburn.com", "thenorthwestern.com", "raising.fi",
  "osiztechnologies.com", "inforcapital.com", "gmacouncil.org", "detroit.co",
]);

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractCompanyDomain(text, fallbackDomain) {
  // Try to find a company website URL in the text (e.g., "visit company.com" or "www.company.io")
  const domainMatch = text.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.(?:com|io|ai|co|dev|tech|app|so|xyz))\b/i);
  if (domainMatch) {
    const found = domainMatch[1].toLowerCase();
    if (!NEWS_DOMAINS.has(found)) return found;
  }
  // Fall back to article domain only if it's not a news site
  if (fallbackDomain && !NEWS_DOMAINS.has(fallbackDomain)) return fallbackDomain;
  return null;
}

function extractFundingAmount(text) {
  // Match patterns like "$50M", "$120 million", "$50m"
  const match = text.match(/\$(\d+(?:\.\d+)?)\s*(?:m(?:illion)?|M)/i);
  if (match) return `$${match[1]}M`;
  // Match patterns like "$1.2B", "$1 billion"
  const bMatch = text.match(/\$(\d+(?:\.\d+)?)\s*(?:b(?:illion)?|B)/i);
  if (bMatch) return `$${bMatch[1]}B`;
  return null;
}

function extractFundingDate(text) {
  // Look for month + year patterns
  const months = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
  const match = text.match(new RegExp(`(${months})\\s+(\\d{4})`, "i"));
  if (match) return match[0];
  return null;
}

function isStaleFunding(fundingDate) {
  if (!fundingDate) return false; // no date = can't tell, don't filter
  const monthMap = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  const parts = fundingDate.match(/(\w+)\s+(\d{4})/);
  if (!parts) return false;
  const month = monthMap[parts[1].toLowerCase()];
  const year = parseInt(parts[2]);
  if (month === undefined || isNaN(year)) return false;
  const fundDate = new Date(year, month, 15); // mid-month estimate
  const now = new Date();
  const daysSince = (now - fundDate) / (1000 * 60 * 60 * 24);
  return daysSince > 90;
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Strip common prefixes that aren't part of the company name
// e.g., "Detroit Fintech Startup Autobooks" → "Autobooks"
function cleanCompanyName(raw) {
  const prefixPatterns = [
    /^(?:the\s+)?(?:\w+\s+){0,3}(?:fintech|saas|ai|tech|startup|company|lab|labs|applied)\s+(?:startup\s+|lab\s+|labs\s+)?/i,
  ];
  let name = raw.trim();
  for (const p of prefixPatterns) {
    const match = name.match(p);
    if (match) {
      const rest = name.slice(match[0].length).trim();
      // Only strip if the remainder looks like a company name (1-4 words, starts with uppercase)
      if (rest && rest.length >= 2 && /^[A-Z]/.test(rest) && rest.split(/\s+/).length <= 4) {
        name = rest;
      }
    }
  }
  return name;
}

// Fuzzy dedup: check if a normalized name is a substring of an existing candidate or vice versa
// e.g., "mistral" and "mistralai" should match
function findExistingCandidate(candidates, normalized) {
  if (candidates.has(normalized)) return normalized;
  for (const existing of candidates.keys()) {
    // One contains the other and the shorter is at least 4 chars
    if (existing.length >= 4 && normalized.length >= 4) {
      if (normalized.includes(existing) || existing.includes(normalized)) {
        return existing;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ICP Scoring — filter companies against Nick's target profile
// ---------------------------------------------------------------------------

function scoreICP(blob, amount) {
  let score = 0;
  const lower = blob.toLowerCase();

  // Sector match (+2 for strong, +1 for moderate)
  const sectorHits = ICP_POSITIVE_SECTORS.filter((s) => lower.includes(s));
  if (sectorHits.length >= 3) score += 2;
  else if (sectorHits.length >= 1) score += 1;

  // Negative sector (-2)
  const negHits = ICP_NEGATIVE_SECTORS.filter((s) => lower.includes(s));
  if (negHits.length >= 2) score -= 2;
  else if (negHits.length >= 1) score -= 1;

  // Funding stage: Series B or C is ideal (+1)
  if (/series\s+[bc]/i.test(lower)) score += 1;
  // Series A is OK but early (+0), Series D+ is fine (+0)
  // Seed/pre-seed is too early (-1)
  if (/\b(?:seed|pre-seed|angel)\b/i.test(lower)) score -= 1;

  // Employee count signals
  const empMatch = lower.match(/(\d+)\s*(?:employees|people|team members|headcount)/);
  if (empMatch) {
    const count = parseInt(empMatch[1]);
    if (count >= 50 && count <= 500) score += 1;      // ideal range
    else if (count >= 20 && count < 50) score += 0;    // acceptable
    else if (count < 20) score -= 1;                   // too small
    else if (count > 1000) score -= 1;                 // too big
  }

  // Funding amount: $20M-$300M is the sweet spot
  if (amount) {
    const numMatch = amount.match(/\$(\d+(?:\.\d+)?)/);
    if (numMatch) {
      const num = parseFloat(numMatch[1]);
      const isBillion = amount.includes("B");
      const amountM = isBillion ? num * 1000 : num;
      if (amountM >= 20 && amountM <= 300) score += 1;
      else if (amountM < 5) score -= 1;
    }
  }

  // B2B signals (+1)
  if (/\bb2b\b/i.test(lower)) score += 1;

  return score; // range roughly -3 to +6
}

// ICP threshold: companies scoring below this are filtered out
const ICP_MIN_SCORE = 1;

function findExistingSeen(signalSeen, normalized) {
  if (signalSeen[normalized]) return normalized;
  for (const existing of Object.keys(signalSeen)) {
    if (existing.length >= 4 && normalized.length >= 4) {
      if (normalized.includes(existing) || existing.includes(normalized)) {
        return existing;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Exa API
// ---------------------------------------------------------------------------

async function exaSearch(query, opts = {}) {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    console.error("ERROR: EXA_API_KEY not set. Add it to .env and retry.");
    process.exit(1);
  }

  const body = {
    query,
    type: "neural",
    numResults: opts.numResults || 10,
    startPublishedDate: opts.startDate || thirtyDaysAgo(),
    excludeDomains: EXCLUDE_DOMAINS,
    contents: {
      text: { maxCharacters: opts.maxChars || 1500 },
      highlights: {
        maxCharacters: 300,
        query: opts.highlightQuery || "company funding series round raised",
      },
    },
  };

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`  Exa error (${res.status}): ${errText.slice(0, 100)}`);
    return [];
  }

  const data = await res.json();
  return data.results || [];
}

// ---------------------------------------------------------------------------
// Layer 1: Funding Discovery
// ---------------------------------------------------------------------------

async function discoverFundedCompanies(signalSeen, trackedCompanies) {
  console.log(`[Layer 1] Funding discovery — ${FUNDING_QUERIES.length} queries\n`);

  const candidates = new Map(); // domain -> company info
  let queryCount = 0;

  for (const query of FUNDING_QUERIES) {
    queryCount++;
    process.stdout.write(`  Q${queryCount}: ${query.slice(0, 60)}...`);

    try {
      const results = await exaSearch(query, {
        numResults: 15,
        highlightQuery: "company name funding raised series round amount",
      });
      process.stdout.write(` ${results.length} results\n`);

      for (const r of results) {
        const title = r.title || "";
        const text = r.text || "";
        const highlights = (r.highlights || []).join(" ");
        const blob = `${title} ${text} ${highlights}`;
        const url = r.url || "";
        const domain = extractDomain(url);

        // Extract company name from title (usually "Company raises $XM...")
        const companyMatch = title.match(/^(.+?)\s+(?:raises|closes|secures|announces|lands|gets|nabs|completes)/i);
        if (!companyMatch) continue;

        const companyName = cleanCompanyName(companyMatch[1]);
        if (companyName.length < 2 || companyName.length > 50) continue;

        const normalized = normalizeName(companyName);

        // Skip if already tracked in companies.yml (fuzzy match)
        if (trackedCompanies.has(normalized) ||
            [...trackedCompanies].some((t) => t.length >= 4 && normalized.length >= 4 &&
              (normalized.includes(t) || t.includes(normalized)))) {
          continue;
        }

        // Skip if recently checked (fuzzy match on seen)
        const seenKey = findExistingSeen(signalSeen, normalized);
        if (seenKey && !shouldRecheck(signalSeen[seenKey])) {
          continue;
        }

        // Skip crypto/web3 unless big raise
        const amount = extractFundingAmount(blob);
        if (isCryptoCompany(blob)) {
          const numMatch = amount?.match(/\$(\d+(?:\.\d+)?)/);
          const amountNum = numMatch ? parseFloat(numMatch[1]) : 0;
          if (amountNum < 50) continue;
        }

        const fundingDate = extractFundingDate(blob);

        // Skip stale funding (older than 90 days)
        if (isStaleFunding(fundingDate)) continue;

        // ICP filter: score company against target profile
        const icpScore = scoreICP(blob, amount);
        if (icpScore < ICP_MIN_SCORE) continue;

        // Extract actual company domain from text, not the news article domain
        const companyDomain = extractCompanyDomain(blob, domain);

        // Fuzzy dedupe: check if this company is already a candidate under a different name
        const existingKey = findExistingCandidate(candidates, normalized);
        if (existingKey) {
          // Merge: update with richer data if available
          const existing = candidates.get(existingKey);
          if (amount && !existing.amount) existing.amount = amount;
          if (companyDomain && !existing.domain) existing.domain = companyDomain;
          if (fundingDate && !existing.fundingDate) existing.fundingDate = fundingDate;
          if (icpScore > (existing.icpScore || 0)) existing.icpScore = icpScore;
        } else {
          candidates.set(normalized, {
            name: companyName,
            normalized,
            domain: companyDomain,
            sourceUrl: url,
            amount,
            fundingDate,
            icpScore,
            snippet: text.slice(0, 200),
          });
        }
      }
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
    }

    if (queryCount < FUNDING_QUERIES.length) await sleep(QUERY_DELAY_MS);
  }

  console.log(`\n  Candidates after Layer 1 + ICP filter: ${candidates.size}\n`);
  return { candidates, queryCount };
}

// ---------------------------------------------------------------------------
// Layer 2: Combined absence check + leadership confirmation
// ---------------------------------------------------------------------------

async function checkSignals(candidates, signalSeen) {
  console.log(`[Layer 2] Absence check + GTM activity — ${candidates.size} companies\n`);

  const highConviction = [];
  const monitor = [];
  const alreadyPosting = [];
  let queryCount = 0;

  for (const [normalized, company] of candidates) {
    queryCount++;
    process.stdout.write(`  ${queryCount}/${candidates.size} ${company.name}...`);

    try {
      // Single combined query: check for GTM Engineer postings, any sales/GTM roles,
      // leadership, hiring signals, and GTM expansion mentions
      const combinedQuery = `${company.name} GTM Engineer OR Revenue Operations OR RevOps OR sales OR "go-to-market" OR hiring OR growth OR team`;
      const results = await exaSearch(combinedQuery, {
        numResults: 10,
        maxChars: 800,
        highlightQuery: "GTM Engineer RevOps sales hiring growth team revenue go-to-market expansion",
      });

      // Analyze results with sentence-level co-occurrence detection
      let hasGTMPosting = false;
      let hasGTMActivity = false;
      let postingUrl = null;
      let convictionReason = null;
      let convictionStrength = 0; // track cumulative evidence

      for (const r of results) {
        const title = (r.title || "").toLowerCase();
        const text = (r.text || "").toLowerCase();
        const highlights = ((r.highlights || []).join(" ")).toLowerCase();
        const blob = `${title} ${text} ${highlights}`;
        const url = r.url || "";

        // Check relevance — does this result actually mention the company?
        const companyLower = company.name.toLowerCase();
        const companyWords = companyLower.split(/\s+/);
        const mentionsCompany = companyWords.some((w) => w.length > 2 && blob.includes(w));
        if (!mentionsCompany) continue;

        // Split into sentences for co-occurrence checks
        const sentences = blob.split(/[.!?\n]+/).filter((s) => s.trim().length > 10);

        const isJobPosting = /job|career|hiring|apply|position|opening|posting/.test(blob);

        // CHECK 1: Existing GTM Engineer posting (already posting — route to scan-jobs)
        const gtmKeywords = [
          "gtm engineer", "revenue engineer", "revenue operations engineer",
          "revops engineer", "gtm operations engineer", "go-to-market engineer",
        ];
        if (isJobPosting && gtmKeywords.some((kw) => blob.includes(kw))) {
          hasGTMPosting = true;
          postingUrl = url;
          break;
        }

        // CHECK 2: Any sales/GTM/revenue role posted (strong signal — same URL has job + sales keyword)
        const salesRoleKeywords = [
          "account executive", "sales manager", "sales director",
          "business development", "revenue operations", "revops",
          "sales operations", "demand gen",
        ];
        if (isJobPosting && salesRoleKeywords.some((kw) => blob.includes(kw))) {
          convictionStrength += 2;
          if (!convictionReason) convictionReason = "hiring for sales/GTM roles";
        }

        // CHECK 3: Revenue leadership — require in same sentence as company or on team/about page
        const leadershipPatterns = [
          /(?:vp|vice president)\s+(?:of\s+)?(?:sales|revenue|go.to.market)/,
          /head\s+of\s+(?:sales|revenue|go.to.market|growth)/,
          /chief\s+revenue\s+officer/,
          /\bcro\b/,
          /director\s+(?:of\s+)?(?:sales|revenue|gtm)/,
        ];
        const isTeamPage = /team|about|leadership|people/.test(url + " " + title);
        if (isTeamPage && leadershipPatterns.some((p) => p.test(blob))) {
          convictionStrength += 2;
          if (!convictionReason) convictionReason = "revenue leadership on team page";
        } else {
          // Not a team page — require leadership mention in a sentence that also mentions the company
          for (const sentence of sentences) {
            const hasLeader = leadershipPatterns.some((p) => p.test(sentence));
            const hasCompany = companyWords.some((w) => w.length > 2 && sentence.includes(w));
            if (hasLeader && hasCompany) {
              convictionStrength += 1;
              if (!convictionReason) convictionReason = "revenue leadership identified";
              break;
            }
          }
        }

        // CHECK 4: Growth/hiring signals — require co-occurrence with GTM/sales in SAME SENTENCE
        const gtmTerms = /(?:sales|gtm|go.to.market|revenue|growth)\s+(?:team|org|function|infrastructure|operations)/;
        const growthVerbs = /(?:hiring|growing|expanding|scaling|building|plans?\s+to\s+(?:hire|grow|expand))/;
        for (const sentence of sentences) {
          if (gtmTerms.test(sentence) && growthVerbs.test(sentence)) {
            convictionStrength += 2;
            if (!convictionReason) convictionReason = "GTM growth/hiring plans in context";
            break;
          }
        }

        // CHECK 5: Funding + GTM in SAME SENTENCE (not just same paragraph)
        const fundingTerms = /(?:fund(?:ing|s|ed)|rais(?:e[sd]?|ing)|capital|round|investment)/;
        const gtmExpansion = /(?:sales|gtm|go.to.market|revenue|growth|commercial)/;
        for (const sentence of sentences) {
          if (fundingTerms.test(sentence) && gtmExpansion.test(sentence)) {
            convictionStrength += 2;
            if (!convictionReason) convictionReason = "funding tied to GTM expansion";
            break;
          }
        }
      }

      // Require conviction strength >= 2 to be HIGH CONVICTION
      // This prevents single weak signals from triggering
      hasGTMActivity = convictionStrength >= 2;

      // Classify
      if (hasGTMPosting) {
        process.stdout.write(` ALREADY POSTING\n`);
        alreadyPosting.push({ ...company, postingUrl });
      } else if (hasGTMActivity) {
        process.stdout.write(` HIGH CONVICTION (${convictionReason})\n`);
        highConviction.push({
          ...company,
          convictionReason,
        });
      } else {
        process.stdout.write(` MONITOR\n`);
        monitor.push(company);
      }

      // Update seen record
      signalSeen[normalized] = {
        lastChecked: today(),
        name: company.name,
        amount: company.amount,
        result: hasGTMPosting ? "posting" : hasGTMActivity ? "high" : "monitor",
      };
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
      monitor.push(company);
    }

    await sleep(QUERY_DELAY_MS);
  }

  console.log(`\n  High conviction: ${highConviction.length}`);
  console.log(`  Monitor: ${monitor.length}`);
  console.log(`  Already posting: ${alreadyPosting.length}\n`);

  return { highConviction, monitor, alreadyPosting, queryCount };
}

// ---------------------------------------------------------------------------
// Layer 3: Outreach enrichment — find the person to contact
// ---------------------------------------------------------------------------

async function enrichOutreachTargets(highConviction) {
  if (highConviction.length === 0) return 0;

  console.log(`[Layer 3] Outreach enrichment — ${highConviction.length} targets\n`);
  let queryCount = 0;

  for (const company of highConviction) {
    queryCount++;
    process.stdout.write(`  ${queryCount}/${highConviction.length} ${company.name}...`);

    try {
      // Two queries: theorg.com for org charts, then LinkedIn as fallback
      // No date filter — org charts and LinkedIn profiles don't have publish dates
      const orgQuery = `"${company.name}" VP Sales OR CRO OR "Head of Sales" OR "Head of Revenue" OR "Head of GTM" site:theorg.com OR site:linkedin.com`;
      const results = await exaSearch(orgQuery, {
        numResults: 8,
        maxChars: 600,
        startDate: "2020-01-01T00:00:00.000Z", // wide window — profiles don't have recent dates
        highlightQuery: `${company.name} VP Sales CRO Head Revenue GTM`,
      });

      const companyLower = company.name.toLowerCase();
      const companyWords = companyLower.split(/\s+/);

      for (const r of results) {
        const title = (r.title || "");
        const text = (r.text || "");
        const url = r.url || "";
        const blob = `${title} ${text}`.toLowerCase();

        // Must mention the company
        if (!companyWords.some((w) => w.length > 2 && blob.includes(w))) continue;

        // Relevant title check (reused across patterns) — handles both "VP Sales" and "Sales VP" orderings
        const isRelevantTitle = (t) =>
          /(?:vp|vice president|head|chief|director|svp|leader)\s*(?:of\s+|,?\s+)?(?:sales|revenue|go.to.market|gtm|growth|commercial|business development)/i.test(t) ||
          /(?:sales|revenue|gtm|go.to.market|growth|commercial)\s+(?:vp|vice president|head|chief|director|svp|leader)/i.test(t) ||
          /\b(?:cro|chief revenue officer)\b/i.test(t);

        // Pattern 1: LinkedIn "FirstName LastName - Title at Company"
        const linkedinMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[-–—|]\s*(.+)/);
        if (linkedinMatch && isRelevantTitle(linkedinMatch[2])) {
          company.contactName = linkedinMatch[1].trim();
          company.contactTitle = linkedinMatch[2].trim();
          company.contactUrl = url.includes("linkedin.com") ? url : null;
          process.stdout.write(` ${company.contactName} (${company.contactTitle.slice(0, 40)})\n`);
          break;
        }

        // Pattern 2: theorg.com org charts — text has "Name - Title at Company"
        if (url.includes("theorg.com")) {
          // Verify this is the right company's org chart, not a similarly-named one
          // theorg URLs: theorg.com/org/{company-slug}/org-chart/...
          const orgPath = url.toLowerCase();
          const orgSlugMatch = orgPath.match(/theorg\.com\/org\/([^/]+)/);
          if (!orgSlugMatch) continue;
          const orgSlug = orgSlugMatch[1];
          // Company slug must be a substantial match (not just "ai" or "applied")
          const companySlug = companyLower.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          const slugWords = companySlug.split("-").filter((w) => w.length > 3);
          const orgMatch = orgSlug.includes(companySlug) || slugWords.some((w) => orgSlug.includes(w));
          if (!orgMatch) continue;

          // theorg text format: "Name - Title at Company" (handles both "VP Sales" and "Sales Leader" orders)
          const orgTitleMatch = text.match(
            /(?:VP|Vice President|Head|Chief|Director|SVP|Leader|Manager)\s*(?:of\s+|,?\s+)?(?:Sales|Revenue|GTM|Go-to-Market|Growth|Commercial|Business Development)/i
          ) || text.match(
            /(?:Sales|Revenue|GTM|Go-to-Market|Growth|Commercial|Business Development)\s+(?:VP|Vice President|Head|Chief|Director|SVP|Leader|Manager)/i
          );
          if (orgTitleMatch) {
            // theorg titles are just the person's name — clean it
            const rawName = title.replace(/\s*[|–—-].*$/, "").trim();
            company.contactName = rawName;
            company.contactTitle = orgTitleMatch[0].trim();
            company.contactUrl = null;
            process.stdout.write(` ${rawName} (${company.contactTitle.slice(0, 40)}) [via theorg]\n`);
            break;
          }
        }

        // Pattern 3: Fallback — "Name, Title" in body text
        const textMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)[,\s]+(?:the\s+)?(?:VP|Head|Chief|Director|SVP)\s+(?:of\s+)?(?:Sales|Revenue|GTM|Go-to-Market|Growth|Commercial)/);
        if (textMatch) {
          company.contactName = textMatch[0].split(/[,]/)[0].trim();
          company.contactTitle = textMatch[0].replace(company.contactName, "").replace(/^[,\s]+/, "").trim();
          company.contactUrl = url.includes("linkedin.com") ? url : null;
          process.stdout.write(` ${company.contactName} (${company.contactTitle.slice(0, 40)})\n`);
          break;
        }
      }

      if (!company.contactName) {
        process.stdout.write(` no contact found\n`);
      }
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}\n`);
    }

    await sleep(QUERY_DELAY_MS);
  }

  console.log();
  return queryCount;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(highConviction, monitor, alreadyPosting, stats) {
  const date = today();
  let md = `# Signal Scan — ${date}\n\n`;

  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Exa queries used | ${stats.totalQueries} |\n`;
  md += `| Companies discovered | ${stats.candidatesFound} |\n`;
  md += `| High conviction targets | ${highConviction.length} |\n`;
  md += `| Monitor targets | ${monitor.length} |\n`;
  md += `| Already posting | ${alreadyPosting.length} |\n\n`;

  md += `---\n\n`;

  // High conviction
  md += `## High Conviction — Reach Out Now\n\n`;
  if (highConviction.length === 0) {
    md += `No high conviction targets this week.\n\n`;
  } else {
    for (const c of highConviction) {
      md += `### ${c.name}\n\n`;
      md += `- **Domain:** ${c.domain || "unknown"}\n`;
      if (c.amount) md += `- **Funding:** ${c.amount}`;
      if (c.fundingDate) md += ` (${c.fundingDate})`;
      if (c.amount) md += `\n`;
      if (c.icpScore) md += `- **ICP score:** ${c.icpScore}\n`;
      md += `- **Signal:** ${c.convictionReason}\n`;
      if (c.contactName) {
        const contactLink = c.contactUrl ? `[${c.contactName}](${c.contactUrl})` : c.contactName;
        md += `- **Contact:** ${contactLink} — ${c.contactTitle}\n`;
      }
      md += `- **Source:** [funding announcement](${c.sourceUrl})\n`;

      // Suggested outreach angle — personalized if we have a contact
      const amountStr = c.amount || "a new round";
      const dateStr = c.fundingDate || "recently";
      if (c.contactName) {
        md += `- **Outreach angle:** Message ${c.contactName} directly: "Hi ${c.contactName.split(" ")[0]}, saw ${c.name} raised ${amountStr} — congrats. I build GTM infrastructure (signal engines, CRM automation, pipeline analytics) and noticed you don't have a GTM Engineer yet. Would love to chat about what I could build for your team."\n`;
      } else {
        md += `- **Outreach angle:** They raised ${amountStr} ${dateStr} and are ${c.convictionReason}. Find the VP Sales or CRO on LinkedIn and lead with: "I build the GTM infrastructure that turns funding into pipeline — saw you just raised and wanted to connect."\n`;
      }
      md += `\n`;
    }
  }

  // Monitor
  md += `## Monitor — Not Ready Yet\n\n`;
  if (monitor.length === 0) {
    md += `No monitor targets this week.\n\n`;
  } else {
    md += `| Company | Domain | Funding | What's Missing |\n`;
    md += `|---------|--------|---------|----------------|\n`;
    for (const c of monitor) {
      const funding = c.amount ? `${c.amount}${c.fundingDate ? ` (${c.fundingDate})` : ""}` : "unknown";
      md += `| ${c.name} | ${c.domain || "—"} | ${funding} | No GTM activity detected — check again next week |\n`;
    }
    md += `\n`;
  }

  // Already posting
  md += `## Already Posting\n\n`;
  if (alreadyPosting.length === 0) {
    md += `No companies found with active GTM postings.\n\n`;
  } else {
    md += `These get picked up by \`scan-jobs\` automatically.\n\n`;
    for (const c of alreadyPosting) {
      const link = c.postingUrl ? `[posting](${c.postingUrl})` : "found via search";
      md += `- **${c.name}** — ${link}\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;
  md += `*Generated by \`scripts/scan-signals.mjs\` — pre-posting signal detection*  \n`;
  md += `*High conviction targets: reach out before they post. Monitor targets: recheck next week.*\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Pipeline integration
// ---------------------------------------------------------------------------

function appendToPipeline(highConviction) {
  if (highConviction.length === 0) return;

  let existing = "";
  if (existsSync(PIPELINE_PATH)) {
    existing = readFileSync(PIPELINE_PATH, "utf-8");
  } else {
    existing = "# Pipeline\n\n## Pending\n\n## Processed\n";
  }

  const newEntries = highConviction
    .filter((c) => c.sourceUrl && !existing.includes(c.sourceUrl))
    .map((c) => `- [ ] signal: ${c.sourceUrl} | ${c.name} | GTM Engineer (pre-posting) | ${c.amount || "funding unknown"}`)
    .join("\n");

  if (!newEntries) return;

  // Insert after "## Pending" line
  const pendingIdx = existing.indexOf("## Pending");
  if (pendingIdx !== -1) {
    const insertAt = existing.indexOf("\n", pendingIdx) + 1;
    const updated = existing.slice(0, insertAt) + newEntries + "\n" + existing.slice(insertAt);
    writeFileSync(PIPELINE_PATH, updated);
    console.log(`  Added ${highConviction.length} signal targets to pipeline.md`);
  } else {
    // No Pending section — append
    writeFileSync(PIPELINE_PATH, existing + "\n## Pending\n" + newEntries + "\n");
    console.log(`  Created pipeline.md with ${highConviction.length} signal targets`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Progress emitter (Step 8 — emits JSONL on stdout when --progress-json
  // is set, no-op otherwise). When enabled, console.log is rerouted to
  // stderr so stdout stays pure JSONL for the API route's parser.
  const progress = createProgress({ kind: "scan-signals" });
  progress.start();

  console.log(`\n=== Signal Scan — ${today()} ===\n`);

  const signalSeen = loadSignalSeen();
  const trackedCompanies = loadTrackedCompanies();

  // Layer 1: Funding discovery
  progress.phase("discover-funded", "started");
  const { candidates, queryCount: l1Queries } = await discoverFundedCompanies(
    signalSeen,
    trackedCompanies
  );
  progress.phase("discover-funded", "finished", {
    meta: { candidates: candidates.size, queries: l1Queries },
  });

  if (candidates.size === 0) {
    console.log("No new candidates found. Nothing to check.");
    saveSignalSeen(signalSeen);

    // Still write a report so the user knows it ran
    const md = generateReport([], [], [], {
      totalQueries: l1Queries,
      candidatesFound: 0,
    });
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(join(REPORTS_DIR, `signal-scan-${today()}.md`), md);
    console.log(`  Report saved: reports/signal-scan-${today()}.md\n`);
    progress.done({
      ok: true,
      summary: "No new candidates found.",
      meta: { exa_queries: l1Queries, candidates: 0 },
    });
    return;
  }

  // Layer 2: Absence check + conviction signals (combined)
  progress.phase("check-signals", "started", { meta: { candidates: candidates.size } });
  const { highConviction, monitor, alreadyPosting, queryCount: l2Queries } =
    await checkSignals(candidates, signalSeen);
  progress.phase("check-signals", "finished", {
    meta: {
      high_conviction: highConviction.length,
      monitor: monitor.length,
      already_posting: alreadyPosting.length,
      queries: l2Queries,
    },
  });

  // Layer 3: Outreach enrichment for high conviction targets
  progress.phase("enrich-outreach", "started", { meta: { targets: highConviction.length } });
  const l3Queries = await enrichOutreachTargets(highConviction);
  progress.phase("enrich-outreach", "finished", { meta: { queries: l3Queries } });

  // Save dedup state
  saveSignalSeen(signalSeen);

  // Generate report
  const totalQueries = l1Queries + l2Queries + l3Queries;
  const md = generateReport(highConviction, monitor, alreadyPosting, {
    totalQueries,
    candidatesFound: candidates.size,
  });

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = join(REPORTS_DIR, `signal-scan-${today()}.md`);
  writeFileSync(reportPath, md);
  console.log(`  Report saved: reports/signal-scan-${today()}.md`);

  // Append high conviction targets to pipeline
  appendToPipeline(highConviction);

  // Summary
  console.log(`\n--- Summary ---`);
  console.log(`  Exa queries used: ${totalQueries}`);
  console.log(`  Companies discovered: ${candidates.size}`);
  console.log(`  High conviction: ${highConviction.length}`);
  console.log(`  Monitor: ${monitor.length}`);
  console.log(`  Already posting: ${alreadyPosting.length}`);

  if (highConviction.length > 0) {
    console.log(`\n  Reach out now:`);
    for (const c of highConviction) {
      const funding = c.amount || "unknown amount";
      const contact = c.contactName ? `→ ${c.contactName}` : "(no contact found)";
      console.log(`    ${c.name.padEnd(25)} ${funding.padEnd(10)} ${contact}`);
    }
    console.log(`\n  Full report: reports/signal-scan-${today()}.md`);
    console.log(`  High conviction targets added to data/pipeline.md\n`);
  } else {
    console.log(`\n  No high conviction targets this week. Check the report for monitor list.\n`);
  }

  progress.done({
    ok: true,
    summary:
      `Signal scan: ${highConviction.length} high-conviction, ${monitor.length} monitor, ` +
      `${alreadyPosting.length} already posting (${candidates.size} candidates, ${totalQueries} Exa queries).`,
    meta: {
      high_conviction: highConviction.length,
      monitor: monitor.length,
      already_posting: alreadyPosting.length,
      candidates: candidates.size,
      exa_queries: totalQueries,
      report_path: reportPath,
    },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
