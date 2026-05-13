#!/usr/bin/env node

/**
 * migrate-seen-urls.mjs — One-time migration to re-extract company names
 * and clean up seen-urls.json using the updated extraction logic.
 *
 * What it does:
 * 1. Re-extracts company names from URLs and titles
 * 2. Removes non-job content (articles, blogs, newsletters)
 * 3. Adds a "company" field to seen-urls entries
 * 4. Reports what changed
 *
 * Usage:
 *   node scripts/migrate-seen-urls.mjs          # dry run
 *   node scripts/migrate-seen-urls.mjs --apply  # write changes
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SEEN_PATH = join(ROOT, "data", "seen-urls.json");
const ENRICHMENT_PATH = join(ROOT, "data", "enrichments.json");

const dryRun = !process.argv.includes("--apply");

// ---------------------------------------------------------------------------
// Company extraction (copied from scan-jobs.mjs updated logic)
// ---------------------------------------------------------------------------

const AGGREGATOR_SUFFIXES = [
  /\s*[-–—|]\s*(?:Jobright\.AI|Remocate|Remotehunter|Jobgether|Built ?In\w*|RevOps Careers|Comeet|Sara's List|WeLoveProduct).*$/i,
  /\s*\|\s*.*$/,
];

function cleanAggregatorCompany(company) {
  let cleaned = company;
  for (const pattern of AGGREGATOR_SUFFIXES) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.trim();
}

function extractCompany(title, url) {
  // Sara's List
  const saraMatch = title.match(/Sara's List\s*-\s*.+?\s+at\s+(.+?)$/i);
  if (saraMatch) return cleanAggregatorCompany(saraMatch[1].trim());

  // Ashby URLs
  if (url.includes("ashbyhq.com")) {
    const slug = new URL(url).pathname.split("/")[1] || "";
    return slug;
  }

  // Greenhouse URLs
  if (url.includes("greenhouse.io")) {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[0] || "";
  }

  // "CompanyName hiring Role" pattern
  const hiringMatch = title.match(/^(.+?)\s+hiring\s+/i);
  if (hiringMatch && hiringMatch[1].length <= 30) {
    return cleanAggregatorCompany(hiringMatch[1].trim());
  }

  // "Role - Company" pattern (e.g., "GTM Engineer - Hebbia")
  const dashCompanyMatch = title.match(/^.+?\s+-\s+([A-Z][A-Za-z0-9. ]+?)(?:\s*$|\s*[-|])/);
  if (dashCompanyMatch && dashCompanyMatch[1].length <= 30) {
    return cleanAggregatorCompany(dashCompanyMatch[1].trim());
  }

  // BuiltIn
  if (url.includes("builtin.com")) {
    const atMatch = title.match(/\bat\s+(.+?)$/i);
    if (atMatch) return cleanAggregatorCompany(atMatch[1]);
  }

  // join.com
  if (url.includes("join.com/companies/")) {
    const joinSlug = url.match(/companies\/([^/]+)/)?.[1] || "";
    if (joinSlug) return joinSlug.charAt(0).toUpperCase() + joinSlug.slice(1);
  }

  // remocate.app
  if (url.includes("remocate.app")) {
    const parts = title.split(/\s*[-–—]\s*/);
    if (parts.length >= 1) return parts[0].trim();
  }

  // RevOps Careers URLs
  if (url.includes("revopscareers.com/job/")) {
    const slug = url.split("/job/")[1] || "";
    const cleaned = slug.replace(/^whatjobs-us-/, "").replace(/^lensa-/, "").replace(/^jobsgemach-/, "");
    const parts = cleaned.split("-");
    const roleWords = ["head", "director", "manager", "senior", "vp", "lead", "revenue", "revops", "gtm", "sales", "associate", "staff", "principal", "remote"];
    const companyParts = [];
    for (const p of parts) {
      if (roleWords.includes(p.toLowerCase())) break;
      companyParts.push(p);
    }
    if (companyParts.length > 0 && companyParts.length <= 4) {
      return companyParts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  // thesaraslist.com
  if (url.includes("thesaraslist.com/jobs/")) {
    const slug = url.split("/jobs/")[1] || "";
    const parts = slug.split("-");
    // Title is usually at the end after company name hash
    // e.g., "gtm-engineer-rillet-new-york-a444fbfd"
    // Company is usually 1-2 words before the location
    const locationWords = ["new", "york", "san", "francisco", "remote", "chicago", "boston", "austin", "los", "angeles"];
    const companyParts = [];
    let foundRole = false;
    for (const p of parts) {
      if (!foundRole && ["gtm", "revenue", "sales", "head", "director", "senior", "vp", "manager"].includes(p)) {
        foundRole = true;
        continue;
      }
      if (foundRole && !locationWords.includes(p) && p.length > 3 && !/^[a-f0-9]{6,}$/.test(p)) {
        companyParts.push(p);
      }
    }
  }

  // Direct career page domains
  const DOMAIN_MAP = {
    "salesloft.com": "Salesloft", "fivetran.com": "Fivetran",
    "klaviyo.com": "Klaviyo", "hubspot.com": "HubSpot",
    "ironclad.ai": "Ironclad", "deel.com": "Deel",
  };
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (DOMAIN_MAP[host]) return DOMAIN_MAP[host];
  } catch {}

  // Jobgether — company usually not extractable without fetching
  // Skip these gracefully

  // "Role at Company" or "Role | Company"
  const atMatch = title.match(/(?:\s+at\s+|\s+@\s+|\s*[|—–]\s*)(.+?)$/i);
  if (atMatch) {
    const co = atMatch[1].trim();
    if (!/revops careers|sara's list|jobgether|hiredock|remotehunter/i.test(co)) {
      return cleanAggregatorCompany(co);
    }
  }

  // Company name in parentheses in title: "Lumiform (Remote): Revenue Operations"
  const parenMatch = title.match(/^([A-Z][A-Za-z0-9.]+)\s*\(/);
  if (parenMatch) return parenMatch[1].trim();

  return "";
}

// ---------------------------------------------------------------------------
// Non-job content filter
// ---------------------------------------------------------------------------

const NON_JOB_URL_PATTERNS = [
  /substack\.com/, /medium\.com/, /\/blog\//, /\/article\//,
  /\/post\//, /\/newsletter/, /\/podcast/, /youtube\.com/,
  /\/p\//, /\/insights\//, /\/resources\//, /\/learn\//,
  /\/guides?\//, /bvp\.com/, /bessemer/, /twitter\.com/,
];

const NON_JOB_TITLE_PATTERNS = [
  /\bpulse\b/i, /\bnewsletter\b/i, /\bdigest\b/i, /\bblog\b/i,
  /\bpodcast\b/i, /\bepisode\b/i, /\bwebinar\b/i,
  /\bthe new .+ discipline\b/i, /\bin \d{4}:/i,
  /\bwhat they pay\b/i, /\bguide to\b/i, /\bhow to\b/i,
  /\bhow do you\b/i, /\bwhat is\b/i, /\btop \d+ .+ trends\b/i,
  /\bsalary in \d{4}\b/i, /\bbest .+ schools\b/i,
  /\bcareer to consider\b/i, /\bcompensation trends\b/i,
];

function isNonJobContent(title, url) {
  if (NON_JOB_URL_PATTERNS.some((p) => p.test(url))) return true;
  if (NON_JOB_TITLE_PATTERNS.some((p) => p.test(title))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Known slug-to-name map
// ---------------------------------------------------------------------------
const SLUG_NAMES = {
  "hebbia-ai": "Hebbia", hebbia: "Hebbia", eliseai: "EliseAI",
  zip: "Zip", ramp: "Ramp", notion: "Notion", linear: "Linear",
  mercury: "Mercury", deel: "Deel", runway: "Runway", vercel: "Vercel",
  supabase: "Supabase", loom: "Loom", superhuman: "Superhuman",
  pave: "Pave", resend: "Resend", raycast: "Raycast", causal: "Causal",
  sardine: "Sardine", replit: "Replit", plain: "Plain",
  rillet: "Rillet", attentive: "Attentive",
  gongio: "Gong", apolloio: "Apollo", apollo: "Apollo",
  salesloft: "Salesloft", fivetran: "Fivetran", hubspotjobs: "HubSpot",
  hubspot: "HubSpot", intercom: "Intercom", mixpanel: "Mixpanel",
  amplitude: "Amplitude", braze: "Braze", iterable: "Iterable",
  klaviyo: "Klaviyo", sendbird: "Sendbird", scribe: "Scribe",
  pindropsecurity: "Pindrop", anaplan: "Anaplan",
  nasuni: "Nasuni", togalai: "Togal.AI",
};

function resolveCompany(raw) {
  if (!raw) return "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return SLUG_NAMES[slug] || raw;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const seen = JSON.parse(readFileSync(SEEN_PATH, "utf-8"));
const enrichments = existsSync(ENRICHMENT_PATH)
  ? JSON.parse(readFileSync(ENRICHMENT_PATH, "utf-8"))
  : {};

let removed = 0;
let companyFixed = 0;
let companyAlreadyOk = 0;
let unchanged = 0;
const removedUrls = [];

const updated = {};

for (const [url, meta] of Object.entries(seen)) {
  const title = meta.title || "";

  // Remove non-job content
  if (isNonJobContent(title, url)) {
    removed++;
    removedUrls.push(`  ${title.slice(0, 50)} | ${url.slice(0, 60)}`);
    // Also remove from enrichments
    if (enrichments[url]) delete enrichments[url];
    continue;
  }

  // Re-extract company
  const rawCompany = extractCompany(title, url);
  const company = resolveCompany(rawCompany);

  if (company && company !== "—") {
    if (!meta.company || meta.company === "Unknown" || meta.company === "—") {
      companyFixed++;
    } else {
      companyAlreadyOk++;
    }
    updated[url] = { ...meta, company };
  } else {
    unchanged++;
    updated[url] = meta;
  }
}

console.log(`\n=== Seen URLs Migration ===\n`);
console.log(`  Total entries: ${Object.keys(seen).length}`);
console.log(`  Non-job removed: ${removed}`);
console.log(`  Company extracted/fixed: ${companyFixed}`);
console.log(`  Company already OK: ${companyAlreadyOk}`);
console.log(`  No company found: ${unchanged}`);
console.log(`  Final count: ${Object.keys(updated).length}`);

if (removed > 0) {
  console.log(`\n  Removed:`);
  removedUrls.forEach((r) => console.log(r));
}

// Show some of the fixes
console.log(`\n  Sample company fixes:`);
let shown = 0;
for (const [url, meta] of Object.entries(updated)) {
  if (meta.company && !seen[url].company && shown < 10) {
    console.log(`    ${meta.company.padEnd(20)} | ${meta.title?.slice(0, 45)}`);
    shown++;
  }
}

// Show remaining unknowns
const stillUnknown = Object.entries(updated).filter(([_, m]) => !m.company);
console.log(`\n  Still no company (${stillUnknown.length}):`);
stillUnknown.slice(0, 8).forEach(([url, meta]) => {
  console.log(`    ${meta.title?.slice(0, 45).padEnd(47)} | ${url.slice(0, 55)}`);
});

if (dryRun) {
  console.log(`\n  DRY RUN — no changes written. Run with --apply to save.\n`);
} else {
  writeFileSync(SEEN_PATH, JSON.stringify(updated, null, 2) + "\n");
  writeFileSync(ENRICHMENT_PATH, JSON.stringify(enrichments, null, 2) + "\n");
  console.log(`\n  Changes saved to seen-urls.json and enrichments.json\n`);
}
