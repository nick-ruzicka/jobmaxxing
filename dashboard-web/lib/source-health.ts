import { join } from "path";
import { readJsonSafe, ROOT } from "./data";
import type {
  AuditFinding,
  SourceHealthRow,
  SourceHealthSummary,
  SourceStatus,
} from "./types";

// Re-syndicator hosts — hidden from default views, kept toggleable.
// Keep in sync with scripts/scan-jobs.mjs AGGREGATOR_HOSTS and lib/data.ts.
export const AGGREGATOR_HOSTS = [
  "revopscareers.com",
  "lensa.com",
  "whatjobs.com",
  "jobright.ai",
  "jobgether.com",
];

// Content-farm / SEO-spam hosts blocked at scan time.
// Keep in sync with scripts/scan-jobs.mjs EXCLUDE_DOMAINS.
export const EXCLUDE_DOMAINS = [
  "flexionis.wuaze.com",
  "novaedge.page.gd",
  "hireza.wuaze.com",
  "joborix.us",
  "jobsgemach.com",
  "talent.com",
  "jooble.org",
  "recruit.net",
  "careerbuilder.com",
  "snagajob.com",
  "simplyhired.com",
  "jobrapido.com",
  "liveblog365.com",
  "totalh.net",
  "wuaze.com",
  "page.gd",
  "saashero.net",
  "2x.marketing",
  "anywhereremotejobs.com",
  "kickstartremote.com",
];

/**
 * Per-host comp-extraction findings.
 *
 * Source: audit/comp-extraction-audit-2026-05-13.md (the in-this-session audit).
 * Update this constant when re-auditing. Recovery rates and diagnoses are sample-derived
 * (n=30); confidence is medium-high for top-volume hosts (BuiltIn, Ashby, Greenhouse) and
 * lower for tail hosts. Keys are bare hostnames or parent domains (matched via parentDomain()).
 */
export const AUDIT_FINDINGS: Record<string, AuditFinding> = {
  "builtin.com": {
    recoveryRate: 0.8,
    diagnosis:
      'JSON-LD JobPosting is present, but the script type is HTML-entity-encoded (type="application/ld&#x2B;json") and JobPosting is nested in an @graph array — naive parsers miss it. ~11% extracted today.',
    fixId: "5a",
    fixLabel:
      "BuiltIn JSON-LD parser — decode &#x2B; in the script type, walk @graph, read baseSalary (minValue/maxValue and single-value scalar forms); fall back to the fa-sack-dollar strip labelled (est.).",
    sampleUrls: ["https://builtin.com/job/revenue-operations-manager/3596033"],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.ashbyhq.com": {
    recoveryRate: 0.85,
    diagnosis:
      'Structured baseSalary is always null; the pay range lives in the JSON-LD "description" prose ("The salary range for this role is $X–$Y"). ~30% extracted today.',
    fixId: "5c",
    fixLabel:
      "Ashby description-prose regex — run the comp regex over the JSON-LD description field, not just the rendered page.",
    sampleUrls: [
      "https://jobs.ashbyhq.com/eliseai/7a74322c-415a-41cb-8956-ee170d3bb267",
    ],
    compSourceTarget: "jsonld_description",
  },
  "job-boards.greenhouse.io": {
    recoveryRate: 0.75,
    diagnosis:
      'No JSON-LD at all; the pay range is a plain server-rendered <div> ("Pay Transparency Range", "Tier N Pay Range", "base salary range", "OTE"). 0% extracted today.',
    fixId: "5d",
    fixLabel: "Greenhouse server-rendered prose regex — pure text regex on the captured JD.",
    sampleUrls: ["https://job-boards.greenhouse.io/apolloio/jobs/5918855004"],
    compSourceTarget: "jd_prose",
  },
  "boards.greenhouse.io": {
    recoveryRate: 0.75,
    diagnosis:
      "Same as job-boards.greenhouse.io — no JSON-LD; pay range in a server-rendered <div>.",
    fixId: "5d",
    fixLabel: "Greenhouse server-rendered prose regex — pure text regex on the captured JD.",
    sampleUrls: ["https://boards.greenhouse.io/braze/jobs/7406001"],
    compSourceTarget: "jd_prose",
  },
  "revopscareers.com": {
    recoveryRate: 0.45,
    diagnosis:
      "Aggregator (quarantined). Emits JSON-LD JobPosting with baseSalary, often the single-value scalar form ($93,730/yr); many entries are thin re-scrapes with no baseSalary. 2% extracted today.",
    fixId: "5b",
    fixLabel:
      "revopscareers JSON-LD parser — same JSON-LD pattern, simpler script-type encoding; handle the single-value scalar baseSalary form.",
    sampleUrls: [
      "https://revopscareers.com/job/mural-revenue-operations-business-partner-united-states",
    ],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.insightpartners.com": {
    recoveryRate: 0.35,
    diagnosis:
      'Getro/Consider-powered SPA — JSON-LD JobPosting (incl. baseSalary when the underlying ATS has it) is in the *raw* HTML even though the page renders client-side; the pipeline scrapes the SPA shell and sees "completely broken HTML". 0% extracted, ~44% scrape errors.',
    fixId: "5e",
    fixLabel:
      "VC-portfolio JSON-LD parser — parse JSON-LD from raw HTML; also recovers the scrape-failure cases. Synergy with Fix #6.",
    sampleUrls: [
      "https://jobs.insightpartners.com/companies/camunda/jobs/47555852-director-revenue-operations",
    ],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.generalcatalyst.com": {
    recoveryRate: 0.3,
    diagnosis:
      "Same Getro/Consider SPA pattern as jobs.insightpartners.com; baseSalary is employer-dependent (fewer of these employers post ranges).",
    fixId: "5e",
    fixLabel: "VC-portfolio JSON-LD parser — parse JSON-LD from raw HTML.",
    sampleUrls: [
      "https://jobs.generalcatalyst.com/companies/ethos-life/jobs/37518699-consumer-revenue-operations-manager",
    ],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.8vc.com": {
    recoveryRate: 0.3,
    diagnosis: "Same Getro/Consider SPA pattern as jobs.insightpartners.com.",
    fixId: "5e",
    fixLabel: "VC-portfolio JSON-LD parser — parse JSON-LD from raw HTML.",
    sampleUrls: [
      "https://jobs.8vc.com/companies/prepared-2/jobs/73547723-business-solutions-architect-sales-operations",
    ],
    compSourceTarget: "jsonld_basesalary",
  },
  "liveblog365.com": {
    recoveryRate: 0.4,
    diagnosis:
      'Spam-blocked (EXCLUDE_DOMAINS). Pages do carry JSON-LD JobPosting with comp in the description ("base compensation band $X–$Y", "Pay: $X–$Y/month"), but JD quality is otherwise poor — not worth recovering unless unquarantined.',
    fixId: "—",
    fixLabel:
      "No fix planned — host is spam-blocked. Recovery only meaningful if the block is lifted.",
    sampleUrls: ["https://hirevector.liveblog365.com/job/revenue-operations-analyst-26"],
    compSourceTarget: "jsonld_description",
  },
  "thesaraslist.com": {
    recoveryRate: 0.2,
    diagnosis:
      "SPA — job-specific pages expire fast (high dead-link rate). ~33% comp already extracted.",
    fixId: "—",
    fixLabel:
      "Low priority — already ~33% covered; remaining gaps are mostly dead postings.",
    sampleUrls: [],
    compSourceTarget: "jd_prose",
  },
};

/**
 * Best-effort registrable parent domain. Returns the last two labels, except for known
 * two-part public suffixes (co.uk etc.) where it returns three.
 */
const TWO_PART_TLDS = new Set([
  "co.uk",
  "com.au",
  "co.jp",
  "co.nz",
  "com.br",
  "co.in",
]);
export function parentDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

// ---------------------------------------------------------------------------
// Inputs (shapes of data/seen-urls.json and data/enrichments.json)
// ---------------------------------------------------------------------------
export interface SeenUrlEntry {
  firstSeen?: string;
  title?: string;
  source?: string;
  company?: string;
  location?: string;
  closed?: boolean;
  closedDate?: string;
}
export type SeenUrlsFile = Record<string, SeenUrlEntry>;
export type EnrichmentEntry = { error?: string; timestamp?: string } & Record<
  string,
  unknown
>;
export type EnrichmentsFile = Record<string, EnrichmentEntry>;

// comp_range values that mean "no usable comp"
const EMPTY_COMP = new Set([
  "",
  "not listed",
  "none",
  "n/a",
  "na",
  "not specified",
  "not disclosed",
  "unknown",
]);
// bare-qualitative comp strings (no $ amount) — count as "not listed" for coverage purposes
const QUALITATIVE_COMP_RE =
  /^(competitive|market|top of market|industry[- ]standard|commensurate|negotiable|doe\b|depends on experience)/i;

function hasRealComp(comp_range: unknown): boolean {
  if (typeof comp_range !== "string") return false;
  const c = comp_range.trim();
  if (!c) return false;
  if (EMPTY_COMP.has(c.toLowerCase())) return false;
  if (QUALITATIVE_COMP_RE.test(c) && !/[$\d]/.test(c)) return false;
  return /[$\d]/.test(c); // require a dollar sign or a digit
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function matchesHostList(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith("." + h));
}

function findAuditFinding(host: string): AuditFinding | null {
  return AUDIT_FINDINGS[host] ?? AUDIT_FINDINGS[parentDomain(host)] ?? null;
}

interface HostAccumulator {
  host: string;
  urls: Set<string>;
  enrichedReal: number;
  scrapeFailures: number;
  fitScores: number[];
  hasCompCount: number;
  notListedCount: number;
  lastSeen: string;
  sourceTags: Set<string>;
}

function classifyStatus(args: {
  host: string;
  hasCompCoverage: number;
  scrapeErrorRate: number;
  maxFit: number | null;
  auditFinding: AuditFinding | null;
}): SourceStatus {
  const { host, hasCompCoverage, scrapeErrorRate, maxFit, auditFinding } = args;
  if (matchesHostList(host, AGGREGATOR_HOSTS)) return "quarantined";
  if (matchesHostList(host, EXCLUDE_DOMAINS)) return "spam-blocked";
  if (auditFinding && auditFinding.recoveryRate >= 0.5 && hasCompCoverage < 0.5)
    return "broken-extractor";
  if (scrapeErrorRate > 0.3 && (maxFit ?? 0) < 4) return "broken-scrape";
  return "healthy";
}

export function computeSourceHealth(
  seenUrls: SeenUrlsFile,
  enrichments: EnrichmentsFile
): { rows: SourceHealthRow[]; summary: SourceHealthSummary } {
  const acc = new Map<string, HostAccumulator>();
  const ensure = (host: string): HostAccumulator => {
    let a = acc.get(host);
    if (!a) {
      a = {
        host,
        urls: new Set(),
        enrichedReal: 0,
        scrapeFailures: 0,
        fitScores: [],
        hasCompCount: 0,
        notListedCount: 0,
        lastSeen: "",
        sourceTags: new Set(),
      };
      acc.set(host, a);
    }
    return a;
  };

  for (const [url, meta] of Object.entries(seenUrls)) {
    const host = hostnameOf(url);
    if (!host) continue;
    const a = ensure(host);
    a.urls.add(url);
    if (meta?.source) a.sourceTags.add(meta.source);
    if (meta?.firstSeen && meta.firstSeen > a.lastSeen) a.lastSeen = meta.firstSeen;
  }

  for (const [url, entry] of Object.entries(enrichments)) {
    const host = hostnameOf(url);
    if (!host) continue;
    const a = ensure(host);
    a.urls.add(url);
    const isError =
      entry &&
      typeof entry === "object" &&
      "error" in entry &&
      Object.keys(entry).every((k) => k === "error" || k === "timestamp");
    if (isError) {
      a.scrapeFailures++;
      continue;
    }
    a.enrichedReal++;
    const fit = (entry as Record<string, unknown>).fit_score;
    if (typeof fit === "number" && Number.isFinite(fit)) a.fitScores.push(fit);
    if (hasRealComp((entry as Record<string, unknown>).comp_range))
      a.hasCompCount++;
    else a.notListedCount++;
  }

  const rows: SourceHealthRow[] = [];
  for (const a of acc.values()) {
    const totalUrls = a.urls.size;
    const enrichedReal = a.enrichedReal;
    const scrapeFailures = a.scrapeFailures;
    const avgFit = a.fitScores.length
      ? a.fitScores.reduce((s, n) => s + n, 0) / a.fitScores.length
      : null;
    const maxFit = a.fitScores.length ? Math.max(...a.fitScores) : null;
    const hitRate = a.fitScores.length
      ? a.fitScores.filter((n) => n >= 6).length / a.fitScores.length
      : null;
    const hasCompCoverage = enrichedReal ? a.hasCompCount / enrichedReal : 0;
    const scrapeErrorRate =
      enrichedReal + scrapeFailures
        ? scrapeFailures / (enrichedReal + scrapeFailures)
        : 0;
    const auditFinding = findAuditFinding(a.host);
    const recoverableCount = Math.round(
      a.notListedCount * (auditFinding?.recoveryRate ?? 0)
    );
    const projectedCompCoverage = enrichedReal
      ? (a.hasCompCount + recoverableCount) / enrichedReal
      : 0;
    const status = classifyStatus({
      host: a.host,
      hasCompCoverage,
      scrapeErrorRate,
      maxFit,
      auditFinding,
    });
    rows.push({
      host: a.host,
      totalUrls,
      enrichedReal,
      scrapeFailures,
      enrichmentRate: totalUrls ? enrichedReal / totalUrls : 0,
      scrapeErrorRate,
      avgFit: avgFit === null ? null : Math.round(avgFit * 10) / 10,
      maxFit,
      hitRate,
      hasCompCount: a.hasCompCount,
      notListedCount: a.notListedCount,
      hasCompCoverage,
      recoverableCount,
      projectedCompCoverage,
      lastSeen: a.lastSeen,
      status,
      auditFinding,
      sourceTags: [...a.sourceTags].sort(),
    });
  }

  rows.sort((a, b) => b.totalUrls - a.totalUrls || a.host.localeCompare(b.host));

  const totalEnriched = rows.reduce((s, r) => s + r.enrichedReal, 0);
  const totalHasComp = rows.reduce((s, r) => s + r.hasCompCount, 0);
  const totalNotListed = rows.reduce((s, r) => s + r.notListedCount, 0);
  const overallRecoverable = rows.reduce((s, r) => s + r.recoverableCount, 0);
  const summary: SourceHealthSummary = {
    totalSources: rows.length,
    healthySources: rows.filter((r) => r.status === "healthy").length,
    brokenSources: rows.filter(
      (r) => r.status === "broken-extractor" || r.status === "broken-scrape"
    ).length,
    quarantinedSources: rows.filter((r) => r.status === "quarantined").length,
    spamBlockedSources: rows.filter((r) => r.status === "spam-blocked").length,
    totalEnriched,
    totalHasComp,
    totalNotListed,
    overallCompCoverage: totalEnriched ? totalHasComp / totalEnriched : 0,
    overallRecoverable,
    overallProjectedCoverage: totalEnriched
      ? (totalHasComp + overallRecoverable) / totalEnriched
      : 0,
  };
  return { rows, summary };
}

export function getSourceHealth(): {
  rows: SourceHealthRow[];
  summary: SourceHealthSummary;
} {
  const seenUrls = readJsonSafe<SeenUrlsFile>(
    join(ROOT, "data", "seen-urls.json"),
    {}
  );
  const enrichments = readJsonSafe<EnrichmentsFile>(
    join(ROOT, "data", "enrichments.json"),
    {}
  );
  return computeSourceHealth(seenUrls, enrichments);
}
