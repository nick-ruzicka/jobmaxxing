import { join } from "path";
import { readJsonSafe, ROOT } from "./data";
import type {
  AuditFinding,
  SourceHealthRow,
  SourceHealthSummary,
  SourceStatus,
} from "./types";

// AGGREGATOR_HOSTS / EXCLUDE_DOMAINS canonical lists live in
// config/source-classification.json — imported here and re-exported so downstream
// consumers that already `import { AGGREGATOR_HOSTS } from "./source-health"` keep
// working without churn.
import {
  AGGREGATOR_HOSTS,
  EXCLUDE_DOMAINS,
  matchesHostList,
} from "./source-classification";
export { AGGREGATOR_HOSTS, EXCLUDE_DOMAINS };

/**
 * Per-host comp-extraction findings.
 *
 * Source: audit/comp-extraction-audit-2026-05-13.md (the in-this-session audit).
 * Update this constant when re-auditing. Recovery rates and diagnoses are sample-derived
 * (n=30); confidence is medium-high for top-volume hosts (BuiltIn, Ashby, Greenhouse) and
 * lower for tail hosts. Keys are bare hostnames or parent domains (matched via parentDomain()).
 *
 * Diagnoses are past-tense for hosts where Fix #5 landed and post-backfill coverage is
 * >50% (BuiltIn, Ashby, job-boards.greenhouse.io). Hosts at or below the 50% threshold
 * carry "In progress (Fix #N, YYYY-MM-DD): X recovered across Y rows, …" notes that
 * make explicit what landed vs what remains. `recoveryRate` values are unchanged — they
 * still feed the broken-extractor classifier and the projected-coverage math.
 */
export const AUDIT_FINDINGS: Record<string, AuditFinding> = {
  "builtin.com": {
    recoveryRate: 0.8,
    diagnosis:
      'JSON-LD JobPosting script type was HTML-entity-encoded (type="application/ld&#x2B;json") with JobPosting nested in an @graph array — naive parsers missed it. Fixed in Fix #5a (2026-05-13): coverage 11% → 83% across two backfill passes (224/401 → 334/401). The second pass used --cooldown-on-403 120 at concurrency 1 to absorb the WAF rate-limit; recovered an additional 120 rows (81 jsonld_basesalary + 36 jd_estimate + 3 jsonld_description) and the cooldown flag triggered 5 times. 35 rows remain WAF-blocked (HTTP 403 even with cooldown); they will recover on a future pass once the WAF cools further.',
    fixId: "5a",
    fixLabel:
      "BuiltIn JSON-LD parser — decode &#x2B; in the script type, walk @graph, read baseSalary (minValue/maxValue and single-value scalar forms); fall back to the fa-sack-dollar strip labelled (est.).",
    sampleUrls: ["https://builtin.com/job/revenue-operations-manager/3596033"],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.ashbyhq.com": {
    recoveryRate: 0.85,
    diagnosis:
      'Structured baseSalary was always null; the pay range lived in the JSON-LD "description" prose ("The salary range for this role is $X–$Y"). Fixed in Fix #5c (2026-05-13): coverage 35% → 80% across 51 backfilled rows (23 from jsonld_description + 13 from jsonld_basesalary surfaced by the broader fix).',
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
      'No JSON-LD at all; pay range was plain server-rendered prose ("Pay Transparency Range", "Tier N Pay Range", "base salary range", "OTE"). Fixed in Fix #5d (2026-05-13): coverage 0% → 67% across 27 backfilled rows via jd_prose regex.',
    fixId: "5d",
    fixLabel: "Greenhouse server-rendered prose regex — pure text regex on the captured JD.",
    sampleUrls: ["https://job-boards.greenhouse.io/apolloio/jobs/5918855004"],
    compSourceTarget: "jd_prose",
  },
  "boards.greenhouse.io": {
    recoveryRate: 0.75,
    diagnosis:
      "Same parser as job-boards.greenhouse.io — no JSON-LD; pay range in server-rendered prose. Fix #5d landed (2026-05-13) but the visible backlog is tiny: 4 URLs, 3 dead, 1 qualitative-only — no comp-bearing rows in current backlog. New postings on this older subdomain will recover at the ~67% rate observed on job-boards.greenhouse.io.",
    fixId: "5d",
    fixLabel: "Greenhouse server-rendered prose regex — pure text regex on the captured JD.",
    sampleUrls: ["https://boards.greenhouse.io/braze/jobs/7406001"],
    compSourceTarget: "jd_prose",
  },
  "revopscareers.com": {
    recoveryRate: 0.45,
    diagnosis:
      "Aggregator (quarantined). Emits JSON-LD JobPosting with baseSalary, often the single-value scalar form ($93,730/yr); many entries are thin re-scrapes with no baseSalary. In progress (Fix #5b, 2026-05-13): 75 recovered across 293 backfilled rows (47 jsonld_basesalary + 28 jsonld_description, coverage 2% → 26%); 187 rows still have no upstream comp signal; 30 tagged qualitative-only.",
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
      'Getro/Consider-powered SPA — JSON-LD JobPosting (incl. baseSalary when the underlying ATS has it) is in the *raw* HTML even though the page renders client-side; the pipeline scrapes the SPA shell and sees "completely broken HTML". In progress (Fix #5e, 2026-05-13): 8 recovered across 25 backfilled rows (jsonld_basesalary, coverage 0% → 32%); 14 employer-side gaps where no range was posted; ~44% historic scrape-error backlog still pending re-scrape (Fix #6).',
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
      "Same Getro/Consider SPA pattern as jobs.insightpartners.com; baseSalary is employer-dependent. In progress (Fix #5e, 2026-05-13): 11 recovered across 22 backfilled rows (10 jsonld_basesalary + 1 jsonld_description, coverage 0% → 50%, exactly at the past-tense threshold); 8 remaining rows are employers that did not post ranges.",
    fixId: "5e",
    fixLabel: "VC-portfolio JSON-LD parser — parse JSON-LD from raw HTML.",
    sampleUrls: [
      "https://jobs.generalcatalyst.com/companies/ethos-life/jobs/37518699-consumer-revenue-operations-manager",
    ],
    compSourceTarget: "jsonld_basesalary",
  },
  "jobs.8vc.com": {
    recoveryRate: 0.3,
    diagnosis:
      "Same Getro/Consider SPA pattern as jobs.insightpartners.com. In progress (Fix #5e, 2026-05-13): 3 recovered across 8 backfilled rows (jsonld_basesalary, coverage 0% → 38%); 4 remaining rows are employers that did not post ranges.",
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

// matchesHostList comes from ./source-classification (imported above).

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

  const isActive = (r: SourceHealthRow) =>
    r.status !== "quarantined" && r.status !== "spam-blocked";
  const totalEnriched = rows.reduce((s, r) => s + r.enrichedReal, 0);
  const totalHasComp = rows.reduce((s, r) => s + r.hasCompCount, 0);
  const totalNotListed = rows.reduce((s, r) => s + r.notListedCount, 0);
  const activeRows = rows.filter(isActive);
  const activeEnriched = activeRows.reduce((s, r) => s + r.enrichedReal, 0);
  const activeHasComp = activeRows.reduce((s, r) => s + r.hasCompCount, 0);
  const overallRecoverable = activeRows.reduce((s, r) => s + r.recoverableCount, 0);
  const additionalRecoverableQuarantined = rows
    .filter((r) => r.status === "quarantined")
    .reduce((s, r) => s + r.recoverableCount, 0);
  const additionalRecoverableSpam = rows
    .filter((r) => r.status === "spam-blocked")
    .reduce((s, r) => s + r.recoverableCount, 0);
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
    activeEnriched,
    activeHasComp,
    overallRecoverable,
    overallProjectedCoverage: totalEnriched
      ? (totalHasComp + overallRecoverable) / totalEnriched
      : 0,
    additionalRecoverableQuarantined,
    additionalRecoverableSpam,
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
