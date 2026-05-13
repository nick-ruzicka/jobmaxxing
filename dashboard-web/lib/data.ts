import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import type {
  Role,
  RoleStatus,
  ScoreProvenance,
  Signal,
  SignalResult,
  Company,
  ScanStats,
  Briefing,
} from "./types";
import { clusterForLocation, flattenLocation, parseLocationString } from "./location-clusters";
import type { StructuredLocation } from "./location-clusters";
import { normalizeCompany, companyKey } from "../../scripts/lib/normalize-company.mjs";

// Re-export for dashboard consumers (`import { companyKey } from "@/lib/data"`).
export { normalizeCompany, companyKey };

export const ROOT = join(process.cwd(), "..");

// Re-syndicator hosts (RevOps Careers, Lensa, WhatJobs, …): unreliable location/company
// metadata, frequently corrupted JD scrapes. Roles from these hosts are tagged
// source_tier:"aggregator" and hidden from default views (toggle in the pipeline filter bar
// to show them). Keep in sync with scripts/scan-jobs.mjs AGGREGATOR_HOSTS.
const AGGREGATOR_HOSTS = [
  "revopscareers.com",
  "lensa.com",
  "whatjobs.com",
  "jobright.ai",
  "jobgether.com",
];

function isAggregatorHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return AGGREGATOR_HOSTS.some((a) => h === a || h.endsWith("." + a));
  } catch {
    return false;
  }
}

export function readJsonSafe<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function readFileSafe(path: string): string {
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Parse applications.md
// ---------------------------------------------------------------------------
function parseApplications(): Map<string, Partial<Role>> {
  const md = readFileSafe(join(ROOT, "data", "applications.md"));
  const map = new Map<string, Partial<Role>>();
  const lines = md.split("\n").filter((l) => l.startsWith("|"));

  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i]
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length < 8) continue;

    const company = cols[2];
    const role = cols[3];
    const key = `${company.toLowerCase()}:${role.toLowerCase()}`;

    map.set(key, {
      score: parseFloat(cols[4]) || 0,
      status: mapStatus(cols[5]),
      notes: cols[8] || "",
    });
  }
  return map;
}

function mapStatus(s: string): RoleStatus {
  const normalized = s.trim().toLowerCase();
  if (normalized === "interview" || normalized === "interviewing")
    return "Interview";
  if (normalized === "applied") return "Applied";
  if (normalized === "evaluated") return "Evaluated";
  if (normalized === "offer") return "Offer";
  if (
    normalized === "rejected" ||
    normalized === "discarded"
  )
    return "Rejected";
  if (normalized === "skip" || normalized === "skipped" || normalized === "do not apply")
    return "Skipped";
  return "Discovered";
}

// ---------------------------------------------------------------------------
// Parse scan report markdown tables
// ---------------------------------------------------------------------------
function parseScanReport(
  content: string
): Array<{
  score: number;
  company: string;
  role: string;
  url: string;
  location: string;
  source: string;
  posted: string;
  comp: string;
  match: string;
}> {
  const results: Array<{
    score: number;
    company: string;
    role: string;
    url: string;
    location: string;
    source: string;
    posted: string;
    comp: string;
    match: string;
  }> = [];

  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    // Match table rows with score in bold
    const scoreMatch = line.match(/\*\*(\d+)\*\*/);
    if (!scoreMatch) continue;

    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length < 7) continue;

    const score = parseInt(scoreMatch[1], 10);
    const company = cols[1];
    // Extract role title and URL from markdown link
    const linkMatch = cols[2].match(/\[([^\]]+)\]\(([^)]+)\)/);
    const role = linkMatch ? linkMatch[1] : cols[2];
    const url = linkMatch ? linkMatch[2] : "";
    const location = cols[3];
    const source = cols[4];
    const posted = cols[5];
    const comp = cols[6] !== "—" ? cols[6] : "";
    const match = cols[7] || "";

    results.push({ score, company, role, url, location, source, posted, comp, match });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Get all roles (merge seen-urls + scan reports + applications)
// ---------------------------------------------------------------------------
export function getRoles(opts: { includeAggregator?: boolean } = {}): Role[] {
  const seenUrls = readJsonSafe<
    Record<string, { firstSeen: string; title: string; source: string }>
  >(join(ROOT, "data", "seen-urls.json"), {});

  const applications = parseApplications();
  const allTrackedSlugs = [...getWatchedSlugs()];
  const enrichments = readJsonSafe<Record<string, Record<string, unknown>>>(
    join(ROOT, "data", "enrichments.json"), {}
  );

  // Manual eval overrides (data/score-overrides.json) — applied last, winning over the
  // priority chain *and* the caps. Keyed by companyKey() = lowercase alphanumerics of the
  // company name (matches scan-jobs.mjs `coKey`).
  type OverrideEntry = { company?: string; score?: number | null; reason?: string };
  const overrides = readJsonSafe<{
    boost?: Record<string, OverrideEntry>;
    penalize?: Record<string, OverrideEntry>;
    block?: string[];
  }>(join(ROOT, "data", "score-overrides.json"), { boost: {}, penalize: {}, block: [] });
  // `companyKey` is the shared helper from scripts/lib/normalize-company.mjs
  // (imported at the top of this file). The local lambda used to live here —
  // removed in favor of the centralized version so alias-mapped names
  // (OpenAI Inc / OpenAI, X / xAI, Norminal.So / Nominal, …) collapse to the
  // same override slot, matching scan-jobs.mjs + sync-score-feedback.mjs.
  const clampScore = (n: number) => Math.max(1, Math.min(10, Math.round(n)));

  // Parse latest scan report for scores and metadata
  const reportsDir = join(ROOT, "reports");
  const scanScoreMap = new Map<
    string,
    { score: number; company: string; location: string; source: string; posted: string; comp: string; match: string }
  >();

  if (existsSync(reportsDir)) {
    const scanFiles = readdirSync(reportsDir)
      .filter((f) => f.startsWith("job-scan-") && f.endsWith(".md"))
      .sort()
      .reverse();

    for (const file of scanFiles.slice(0, 3)) {
      const content = readFileSafe(join(reportsDir, file));
      const rows = parseScanReport(content);
      for (const row of rows) {
        if (row.url && !scanScoreMap.has(row.url)) {
          scanScoreMap.set(row.url, {
            score: row.score,
            company: row.company,
            location: row.location,
            source: row.source,
            posted: row.posted,
            comp: row.comp,
            match: row.match,
          });
        }
      }
    }
  }

  const roles: Role[] = [];
  const seenDedup = new Set<string>(); // deduplicate by company+title

  for (const [url, meta] of Object.entries(seenUrls)) {
    // Filter junk URLs (newsletters, blog posts, tweets)
    if (isJunkUrl(url)) continue;

    const title = meta.title || "";
    // Filter junk titles (newsletter issues, articles)
    if (isJunkTitle(title)) continue;

    const scanData = scanScoreMap.get(url);
    // Company resolution priority: scan report > URL slug > RevOps Careers URL > title parsing
    const migratedCompany = (meta as Record<string, string>).company || "";
    const isAggregatorName = /^(revops careers|sara's list|jobgether|hiredock|remotehunter|lensa)$/i.test(migratedCompany);
    const rawCompany =
      scanData?.company ||
      (!isAggregatorName && migratedCompany) ||
      extractCompanyFromUrl(url) ||
      extractCompanyFromRevOpsCareersUrl(url) ||
      extractCompanyFromTitle(title);
    const company = cleanCompany(rawCompany) || "Unknown";

    const cleanedTitle = cleanTitle(title);

    // Deduplicate by company + normalized title (strips location, level prefixes)
    const normTitle = cleanedTitle
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, "")  // strip parentheticals like (Remote), (Ontario)
      .replace(/,?\s*(new york|nyc|san francisco|sf|remote|hybrid|chicago|boston|austin).*$/i, "")
      .trim();
    const dedupKey = `${company.toLowerCase()}:${normTitle}`;
    if (seenDedup.has(dedupKey)) continue;
    seenDedup.add(dedupKey);

    const appKey = `${company.toLowerCase()}:${cleanedTitle.toLowerCase()}`;
    const appData = applications.get(appKey);

    // Enrichment data (from Claude analysis) — needed before location extraction
    const enrichment = enrichments[url] as Record<string, unknown> | undefined;
    const hasEnrichment = enrichment && !enrichment.error;

    // --- Location ---------------------------------------------------------
    // Prefer the structured fields written by scan-jobs.mjs; fall back to parsing whatever
    // string source we have (scan report → stored string → enrichment.location → enrichment
    // text → title+url), then re-derive the display string and the filter cluster.
    const m = meta as Record<string, unknown>;
    let structured: StructuredLocation;
    if (typeof m.location_workplace === "string") {
      structured = {
        workplace: m.location_workplace as StructuredLocation["workplace"],
        city: (m.location_city as string | null) ?? null,
        region: (m.location_region as string | null) ?? null,
      };
    } else {
      // Legacy entry / fresh-from-enrichment — derive from the best string we can find.
      const storedLocation = (m.location as string) || "";
      const raw =
        (scanData?.location && scanData.location !== "Unknown" && scanData.location) ||
        (storedLocation && storedLocation !== "Unknown" && storedLocation) ||
        (hasEnrichment && typeof enrichment.location === "string" &&
          enrichment.location !== "Not specified" && (enrichment.location as string)) ||
        "";
      structured = parseLocationString(raw) as StructuredLocation;
      if (structured.workplace === "unknown" && !structured.city && hasEnrichment) {
        const eText = [
          enrichment.verdict, enrichment.team_context,
          ...((enrichment.green_flags as string[]) || []),
          ...((enrichment.red_flags as string[]) || []),
        ].filter(Boolean).join(" ");
        structured = parseLocationString(eText) as StructuredLocation;
      }
      if (structured.workplace === "unknown" && !structured.city) {
        structured = parseLocationString(`${title} ${url}`) as StructuredLocation;
      }
    }
    const location = flattenLocation(structured);
    const locationCluster = clusterForLocation(structured);

    // Score priority: application score > enrichment fit_score > scan report score > computed.
    // scoreProvenance records which branch won (drives the corner dot on the score pill).
    let score: number;
    let scoreProvenance: ScoreProvenance;
    if (appData?.score) {
      score = Math.round(appData.score * 2);
      scoreProvenance = "application";
    } else if (hasEnrichment && typeof enrichment.fit_score === "number") {
      score = enrichment.fit_score;
      scoreProvenance = "enriched";
    } else {
      score = scanData?.score || computeScore(cleanedTitle, company, location, allTrackedSlugs);
      scoreProvenance = "heuristic";
    }
    // Post-hoc clamps don't change provenance — they just cap the displayed number.
    let scoreCapped = false;
    if (isFalsePositiveTitle(cleanedTitle) && score > 3) {
      score = 3;
      scoreCapped = true;
    }
    // Pre-enrichment cap: roles without Claude analysis are capped at 7
    // to prevent title-only inflation. Enrichment fit_score or app score can raise above 7.
    if (!hasEnrichment && !appData?.score && score > 7) {
      score = 7;
      scoreCapped = true;
    }
    score = Math.round(score);

    // Manual eval override (data/score-overrides.json) — the final word: wins over the
    // priority chain and the caps. Precedence: block > boost > penalize. boost/penalize
    // entries carry a /5 eval score, which we honor directly (×2 → /10) — more precise than
    // scan-jobs.mjs' coarse +2 / min(4) (see Phase 11 TODO: reconcile the two scoring paths).
    let scoreOverrideReason: string | undefined;
    const ck = companyKey(company);
    if (ck) {
      if ((overrides.block || []).includes(ck)) {
        score = 1;
        scoreProvenance = "override";
        scoreOverrideReason = "Blocked — eval ≤ 1.5/5";
        scoreCapped = false;
      } else if (overrides.boost?.[ck]) {
        const o = overrides.boost[ck];
        score = typeof o.score === "number" ? clampScore(o.score * 2) : clampScore(score + 2);
        scoreProvenance = "override";
        scoreOverrideReason = o.reason;
        scoreCapped = false;
      } else if (overrides.penalize?.[ck]) {
        const o = overrides.penalize[ck];
        score = typeof o.score === "number" ? clampScore(o.score * 2) : Math.min(score, 4);
        scoreProvenance = "override";
        scoreOverrideReason = o.reason;
        scoreCapped = false;
      }
    }

    // Staleness detection: flag roles first seen more than 30 days ago
    const firstSeenDate = meta.firstSeen ? new Date(meta.firstSeen) : null;
    const daysSinceSeen = firstSeenDate ? (Date.now() - firstSeenDate.getTime()) / (1000 * 60 * 60 * 24) : 0;
    const isStale = daysSinceSeen > 30 && !["Interview", "Applied", "Offer"].includes(appData?.status || "");

    // Score explanation: prefer enrichment verdict, fall back to computed signals
    const scoreReasons = hasEnrichment && enrichment.verdict
      ? String(enrichment.verdict)
      : explainScore(cleanedTitle, company, location, allTrackedSlugs, score);

    roles.push({
      id: Buffer.from(url).toString("base64").slice(0, 12),
      url,
      title: cleanedTitle,
      company,
      location,
      location_workplace: structured.workplace,
      location_city: structured.city,
      location_region: structured.region,
      location_cluster: locationCluster,
      source: meta.source || scanData?.source || "Unknown",
      score,
      scoreProvenance,
      scoreCapped,
      scoreOverrideReason,
      status: appData?.status || "Discovered",
      firstSeen: meta.firstSeen || "",
      publishedDate: scanData?.posted || "",
      comp: scanData?.comp || "",
      matchReason: scoreReasons,
      notes: appData?.notes || "",
      stale: isStale,
      closed: !!(meta as Record<string, unknown>).closed,
      source_tier: ((meta as Record<string, unknown>).source_tier === "aggregator" || isAggregatorHost(url))
        ? "aggregator"
        : "trusted",
      enrichment: hasEnrichment ? {
        comp_range: enrichment.comp_range as string | undefined,
        stack: enrichment.stack as string[] | undefined,
        team_context: enrichment.team_context as string | undefined,
        green_flags: enrichment.green_flags as string[] | undefined,
        red_flags: enrichment.red_flags as string[] | undefined,
        build_component: enrichment.build_component as boolean | undefined,
        ai_signal: enrichment.ai_signal as boolean | undefined,
        company_stage: enrichment.company_stage as string | undefined,
        fit_score: enrichment.fit_score as number | undefined,
        verdict: enrichment.verdict as string | undefined,
      } : null,
    });
  }

  roles.sort((a, b) => b.score - a.score);
  if (opts.includeAggregator) return roles;
  return roles.filter((r) => r.source_tier !== "aggregator");
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------
export function getSignals(): Signal[] {
  const raw = readJsonSafe<
    Record<string, { lastChecked: string; name: string; amount: string | null; result: string }>
  >(join(ROOT, "data", "signal-seen.json"), {});

  return Object.entries(raw).map(([slug, data]) => ({
    slug,
    name: data.name,
    amount: data.amount,
    lastChecked: data.lastChecked,
    result: (data.result === "high" ? "high" : data.result) as SignalResult,
  }));
}

// ---------------------------------------------------------------------------
// Companies (cross-reference all sources)
// ---------------------------------------------------------------------------
export function getCompanies(): Company[] {
  const roles = getRoles();
  const signals = getSignals();
  const watchedSlugs = getWatchedSlugs();

  const companyMap = new Map<string, Company>();

  // Seed from roles
  for (const role of roles) {
    const key = role.company.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || key === "—") continue;
    const existing = companyMap.get(key);
    if (existing) {
      existing.roles.push(role);
      existing.rolesFound++;
      if (role.firstSeen > existing.lastActivity) {
        existing.lastActivity = role.firstSeen;
      }
    } else {
      companyMap.set(key, {
        name: role.company,
        slug: key,
        sourceTier: watchedSlugs.has(key) ? "watched" : "scan",
        rolesFound: 1,
        signalStatus: null,
        funding: null,
        lastActivity: role.firstSeen,
        roles: [role],
      });
    }
  }

  // Merge signal data
  for (const signal of signals) {
    const key = signal.slug.toLowerCase().replace(/[^a-z0-9]/g, "");
    const existing = companyMap.get(key);
    if (existing) {
      existing.signalStatus = signal.result;
      existing.funding = signal.amount;
      if (existing.sourceTier === "scan") existing.sourceTier = "signal";
    } else {
      companyMap.set(key, {
        name: signal.name,
        slug: signal.slug,
        sourceTier: "signal",
        rolesFound: 0,
        signalStatus: signal.result,
        funding: signal.amount,
        lastActivity: signal.lastChecked,
        roles: [],
      });
    }
  }

  return Array.from(companyMap.values()).sort(
    (a, b) => b.rolesFound - a.rolesFound || a.name.localeCompare(b.name)
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
export function getStats(): ScanStats {
  const roles = getRoles();
  const signals = getSignals();

  const active = roles.filter(
    (r) => r.status !== "Rejected" && r.status !== "Skipped"
  );
  const interviews = roles.filter((r) => r.status === "Interview");
  const offers = roles.filter((r) => r.status === "Offer");
  const scores = roles.map((r) => r.score).filter((s) => s > 0);
  const avgScore =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;
  const nycCount = roles.filter((r) => r.location_cluster === "nyc").length;
  const remoteCount = roles.filter((r) => r.location_cluster === "remote").length;
  const hasWarmLeads = signals.some((s) => s.result === "high");

  // Find latest scan date from reports
  const reportsDir = join(ROOT, "reports");
  let lastScanDate = "";
  if (existsSync(reportsDir)) {
    const scanFiles = readdirSync(reportsDir)
      .filter((f) => f.startsWith("job-scan-") && f.endsWith(".md"))
      .sort()
      .reverse();
    if (scanFiles.length > 0) {
      lastScanDate = scanFiles[0].replace("job-scan-", "").replace(".md", "");
    }
  }

  return {
    totalDiscovered: roles.length,
    activelyPursuing: active.filter(
      (r) => r.status !== "Discovered"
    ).length,
    interviews: interviews.length,
    offers: offers.length,
    avgScore,
    nycCount,
    remoteCount,
    hasWarmLeads,
    lastScanDate,
  };
}

// ---------------------------------------------------------------------------
// Interview Prep
// ---------------------------------------------------------------------------
export interface InterviewPrep {
  slug: string;
  company: string;
  role: string;
  filename: string;
  content: string;
  sections: { heading: string; content: string }[];
}

export function getInterviewPreps(): InterviewPrep[] {
  const dir = join(ROOT, "interview-prep");
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".md") && f !== "story-bank.md"
  );

  return files.map((f) => {
    const raw = readFileSafe(join(dir, f));
    const slug = f.replace(".md", "");

    // Extract company and role from first heading or filename
    const titleMatch = raw.match(/^#\s+Interview Prep:\s*(.+?)\s*[-—–]\s*(.+)$/m);
    const company = titleMatch ? titleMatch[1].trim() : slug.split("-")[0];
    const role = titleMatch ? titleMatch[2].trim() : slug.replace(/-/g, " ");

    // Parse sections by ## headings
    const sections: { heading: string; content: string }[] = [];
    const sectionRegex = /^## (.+)$/gm;
    let match;
    const headings: { title: string; startOfContent: number; startOfHeading: number }[] = [];

    while ((match = sectionRegex.exec(raw)) !== null) {
      headings.push({
        title: match[1],
        startOfContent: match.index + match[0].length,
        startOfHeading: match.index,
      });
    }

    for (let i = 0; i < headings.length; i++) {
      const contentStart = headings[i].startOfContent;
      const contentEnd = i + 1 < headings.length ? headings[i + 1].startOfHeading : raw.length;
      // Strip trailing --- separators
      const content = raw.slice(contentStart, contentEnd).replace(/\n---\s*$/g, "").trim();
      sections.push({ heading: headings[i].title, content });
    }

    return { slug, company, role, filename: f, content: raw, sections };
  });
}

export function getStoryBank(): string {
  return readFileSafe(join(ROOT, "interview-prep", "story-bank.md"));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export function getWatchedSlugs(): Set<string> {
  const raw = readFileSafe(join(ROOT, "config", "companies.yml"));
  const slugs = new Set<string>();
  const matches = raw.match(/-\s+([a-z0-9-]+)/g);
  if (matches) {
    for (const m of matches) {
      slugs.add(m.replace(/^-\s+/, "").replace(/-/g, ""));
    }
  }
  return slugs;
}

export function getConfig() {
  const raw = readFileSafe(join(ROOT, "config", "companies.yml"));
  const ashbyMatch = raw.match(/ashby_slugs:\s*\n([\s\S]*?)(?=\ngreenhouse_slugs:|$)/);
  const ghMatch = raw.match(/greenhouse_slugs:\s*\n([\s\S]*?)$/);

  const parseEntries = (block: string | undefined) => {
    if (!block) return [];
    return block
      .split("\n")
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => {
        const clean = l.replace(/^\s*-\s*/, "");
        const slug = clean.replace(/#.*$/, "").trim();
        const comment = clean.includes("#") ? clean.replace(/^[^#]*#\s*/, "") : "";
        return { slug, comment };
      });
  };

  return {
    ashby: parseEntries(ashbyMatch?.[1]),
    greenhouse: parseEntries(ghMatch?.[1]),
  };
}

// ---------------------------------------------------------------------------
// Daily briefing — reads JSON produced by scripts/generate-briefing.mjs
// (and scripts/generate-pipeline-health.mjs for the /sources variant).
// ---------------------------------------------------------------------------

/** Returns YYYY-MM-DD for "today" in local time. Generator writes files keyed
 *  by the same local-date string, so this is what the page reads back. */
function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Read the briefing for a specific date from data/briefings/. Returns null
 *  when the file doesn't exist (first-run / never-generated state) or when
 *  it can't be parsed. Used by /today and /sources. */
export function getBriefingForDate(date: string, kind: "daily" | "pipeline-health" = "daily"): Briefing | null {
  const prefix = kind === "pipeline-health" ? "pipeline-health-" : "";
  const path = join(ROOT, "data", "briefings", `${prefix}${date}.json`);
  return readJsonSafe<Briefing | null>(path, null);
}

/** Convenience — today's daily briefing. */
export function getTodaysBriefing(): Briefing | null {
  return getBriefingForDate(todayDateString(), "daily");
}

/** Convenience — today's pipeline-health briefing (used by /sources). */
export function getTodaysPipelineHealthBriefing(): Briefing | null {
  return getBriefingForDate(todayDateString(), "pipeline-health");
}

// ---------------------------------------------------------------------------
// Scoring (used when scan report doesn't have a pre-computed score)
// ---------------------------------------------------------------------------
function computeScore(
  title: string,
  company: string,
  location: string,
  trackedSlugs: string[]
): number {
  let score = 0;
  const t = title.toLowerCase();

  // Title match (base)
  if (t.includes("gtm engineer")) score += 10;
  else if (t.includes("revenue engineer")) score += 9;
  else if (t.includes("gtm operations")) score += 8;
  else if (t.includes("revops") || t.includes("revenue operations")) score += 7;
  else if (t.includes("sales operations") || t.includes("sales ops")) score += 6;
  else if (t.includes("go-to-market") || t.includes("go to market")) score += 7;
  else score += 4;

  // Location
  if (location === "NYC" || location === "Hybrid NYC") score += 2;
  else if (location === "Remote US") score += 1;
  else if (location === "Unknown") score -= 1;

  // Tracked company
  const compSlug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (trackedSlugs.some((s) => compSlug.includes(s.replace(/-/g, "")))) score += 1;

  // Seniority
  const seniorPos = ["senior", "lead", "head", "director", "staff", "principal"];
  const seniorNeg = ["analyst", "coordinator", "associate", "junior", "intern", "specialist"];
  if (seniorPos.some((s) => t.includes(s))) score += 1;
  if (seniorNeg.some((s) => t.includes(s))) score -= 2;

  return Math.max(1, Math.min(10, score));
}

function explainScore(
  title: string,
  company: string,
  location: string,
  trackedSlugs: string[],
  finalScore: number
): string {
  const parts: string[] = [];
  const t = title.toLowerCase();

  if (t.includes("gtm engineer")) parts.push("GTM Engineer");
  else if (t.includes("revenue engineer")) parts.push("Revenue Engineer");
  else if (t.includes("gtm operations")) parts.push("GTM Ops");
  else if (t.includes("revops") || t.includes("revenue operations")) parts.push("RevOps");
  else if (t.includes("sales operations") || t.includes("sales ops")) parts.push("Sales Ops");
  else if (t.includes("go-to-market")) parts.push("GTM");

  if (location === "NYC" || location === "Hybrid NYC") parts.push("NYC");
  else if (location === "Remote US") parts.push("Remote");

  const compSlug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (trackedSlugs.some((s) => compSlug.includes(s.replace(/-/g, "")))) parts.push("Tracked");

  const seniorPos = ["senior", "lead", "head", "director", "staff", "principal"];
  if (seniorPos.some((s) => t.includes(s))) parts.push("Senior+");

  return parts.join(", ") || "Low match";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function cleanTitle(title: string): string {
  return title
    .replace(/^Sara's List\s*-\s*/i, "")
    .replace(/\s*-\s*RevOps Careers$/i, "")
    .replace(/\s*-\s*Jobsgemach$/i, "")
    .replace(/(?:\s+at\s+|\s+@\s+|\s*[|—–]\s*).+$/, "")
    .trim();
}

// Slug-to-name mapping for known Ashby/Greenhouse companies
const SLUG_NAMES: Record<string, string> = {
  "hebbia-ai": "Hebbia", hebbia: "Hebbia", eliseai: "EliseAI",
  zip: "Zip", ramp: "Ramp", notion: "Notion", linear: "Linear",
  mercury: "Mercury", deel: "Deel", runway: "Runway", vercel: "Vercel",
  supabase: "Supabase", loom: "Loom", superhuman: "Superhuman",
  pave: "Pave", resend: "Resend", raycast: "Raycast", causal: "Causal",
  sardine: "Sardine", replit: "Replit", plain: "Plain", incident: "Incident.io",
  snowflake: "Snowflake", airbyte: "Airbyte", qualified: "Qualified",
  chilipiper: "ChiliPiper", rillet: "Rillet", attentive: "Attentive",
  gongio: "Gong", apolloio: "Apollo", apollo: "Apollo",
  salesloft: "Salesloft", fivetran: "Fivetran", hubspotjobs: "HubSpot",
  hubspot: "HubSpot", intercom: "Intercom", mixpanel: "Mixpanel",
  amplitude: "Amplitude", braze: "Braze", iterable: "Iterable",
  klaviyo: "Klaviyo", sendbird: "Sendbird", scribe: "Scribe",
  pindropsecurity: "Pindrop", anaplan: "Anaplan",
  // Also handle company names from RevOps Careers URL parsing
  "scale": "Scale AI", "scaleai": "Scale AI", "scaleaiinc": "Scale AI",
  "scale ai inc": "Scale AI", "gumgum": "GumGum", "findigs": "Findigs",
  "jiko": "Jiko", "pliant": "Pliant", "cognosos": "Cognosos",
  "paragon": "Paragon", "stord": "Stord", "stordinc": "Stord",
  "stord inc remote": "Stord", "ushur": "Ushur", "crusoe": "Crusoe",
  "operant": "Operant AI", "operantai": "Operant AI",
  "ironclad": "Ironclad", "procurify": "Procurify", "lumiform": "Lumiform",
  "youcom": "You.com", "you.com": "You.com", "rezolveai": "Rezolve AI",
  "rezolve ai": "Rezolve AI", "workforce solutions": "Workforce Solutions",
  "postman": "Postman", "render": "Render", "langchain": "LangChain",
  "aven": "Aven", "fireworksai": "Fireworks AI", "fireworks ai": "Fireworks AI",
  "assetwatch": "AssetWatch",
};

function cleanCompany(company: string): string {
  const trimmed = company.replace(/\s+$/, "").replace(/^—$/, "");
  if (!trimmed) return "";
  // Check slug map
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (SLUG_NAMES[slug]) return SLUG_NAMES[slug];
  // Skip known aggregator names that aren't real companies
  if (/^(revops careers|sara's list|jobgether|geekfinders|lensa)$/i.test(trimmed)) return "";
  // Capitalize first letter of each word, then fix common acronyms
  return trimmed
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bAi\b/g, "AI")
    .replace(/\bInc\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractCompanyFromTitle(title: string): string {
  // "Sara's List - GTM Engineer at Zip" → "Zip"
  const saraMatch = title.match(/Sara's List\s*-\s*.+?\s+at\s+(.+?)$/i);
  if (saraMatch) return saraMatch[1].trim();
  // "Role at Company" or "Role | Company"
  const atMatch = title.match(/(?:\s+at\s+|\s+@\s+)(.+?)$/i);
  if (atMatch) {
    const co = atMatch[1].trim();
    if (!/revops careers|sara's list|jobgether/i.test(co)) return co;
  }
  return "";
}

function extractCompanyFromRevOpsCareersUrl(url: string): string {
  if (!url.includes("revopscareers.com/job/")) return "";
  const slug = url.split("/job/")[1] || "";
  const cleaned = slug
    .replace(/^whatjobs-us-/, "")
    .replace(/^lensa-/, "")
    .replace(/^jobsgemach-/, "");
  const parts = cleaned.split("-");
  const roleWords = ["head", "director", "manager", "senior", "vp", "lead", "revenue", "revops", "gtm", "sales", "associate", "staff", "principal", "remote"];
  const companyParts: string[] = [];
  for (const p of parts) {
    if (roleWords.includes(p.toLowerCase())) break;
    companyParts.push(p);
  }
  if (companyParts.length > 0 && companyParts.length <= 4) {
    return companyParts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return "";
}

// Map domains to company names for career page URLs
const DOMAIN_COMPANIES: Record<string, string> = {
  "salesloft.com": "Salesloft",
  "fivetran.com": "Fivetran",
  "klaviyo.com": "Klaviyo",
  "hubspot.com": "HubSpot",
  "join.com": "", // aggregator, company in path
};

function extractCompanyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("ashbyhq.com")) {
      const slug = u.pathname.split("/")[1] || "";
      return SLUG_NAMES[slug] || slug || "";
    }
    if (u.hostname.includes("greenhouse.io")) {
      const parts = u.pathname.split("/");
      const slug = parts[1] || parts[2] || "";
      return SLUG_NAMES[slug] || slug || "";
    }
    // Career page domains
    const host = u.hostname.replace(/^www\./, "");
    if (DOMAIN_COMPANIES[host] !== undefined) return DOMAIN_COMPANIES[host];
    // join.com/companies/{slug}/...
    if (host === "join.com" && u.pathname.includes("/companies/")) {
      const slug = u.pathname.split("/companies/")[1]?.split("/")[0] || "";
      return slug.charAt(0).toUpperCase() + slug.slice(1);
    }
    return "";
  } catch {
    return "";
  }
}

// URLs that are not job postings (blogs, newsletters, articles)
const JUNK_URL_PATTERNS = [
  "substack.com",
  "/blog/",
  "/article/",
  "/post/",
  "/insights/",
  "/resources/",
  "/learn/",
  "/guide/",
  "/guides/",
  "medium.com",
  "linkedin.com/pulse",
  "linkedin.com/posts",
  "bvp.com",
  "bessemer",
  "revopscareers.com/blog",
  "twitter.com",
  "x.com",
  "youtube.com",
  "prnewswire.com",
  "globenewswire.com",
  "businesswire.com",
  "innovationopenlab.com",
  "devcommx.com/blogs",
];

// Title patterns that indicate non-jobs (newsletters, articles)
const JUNK_TITLE_PATTERNS = [
  /^#\d+/,           // "#22 - by Matteo Tittarelli"
  /newsletter/i,
  /podcast/i,
  /blog post/i,
  /webinar/i,
  /\bby\s+[A-Z]/,   // "by Author Name"
  /Bessemer Venture/i,
  /seven-figure deals/i,
  /how .+ went from/i,  // article pattern "How X went from Y to Z"
  /\bhow do you\b/i,
  /\bwhat is\b/i,
  /\btop \d+ .+ trends\b/i,
  /\bsalary in \d{4}\b/i,
  /\bcompensation trends\b/i,
  /\bcareer to consider\b/i,
];

// Roles that should NOT score high even if they contain GTM keywords
const FALSE_POSITIVE_TITLES = [
  "product designer",
  "ux designer",
  "ui designer",
  "graphic designer",
  "brand designer",
  "content writer",
  "copywriter",
  "recruiter",
  "recruiting",
  "talent acquisition",
  "data engineer",
  "data analyst",
  "fp&a",
  "finance manager",
  "accounting",
];

function isJunkUrl(url: string): boolean {
  return JUNK_URL_PATTERNS.some((p) => url.toLowerCase().includes(p));
}

function isJunkTitle(title: string): boolean {
  return JUNK_TITLE_PATTERNS.some((p) => p.test(title));
}

function isFalsePositiveTitle(title: string): boolean {
  const t = title.toLowerCase();
  return FALSE_POSITIVE_TITLES.some((fp) => t.includes(fp));
}
