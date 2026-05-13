export type RoleStatus =
  | "Discovered"
  | "Evaluated"
  | "Applied"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Skipped";

/** Where a role's score came from, in trust order:
 *  "override"    — manual eval override from data/score-overrides.json (wins over everything)
 *  "enriched"    — Claude analyzed the JD (enrichment.fit_score)
 *  "application" — pulled from the application tracker (applications.md)
 *  "heuristic"   — title/location/company keyword math, no JD read (scan report or computeScore) */
export type ScoreProvenance = "override" | "enriched" | "application" | "heuristic";

export interface Role {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string;
  /** Structured location, populated from seen-urls.json (or parsed from `location` for
   *  legacy entries). `location` above is the display string derived from these. */
  location_workplace: "remote" | "hybrid" | "onsite" | "unknown";
  location_city: string | null;
  /** 2-letter state code for US locations, country name for international, else null. */
  location_region: string | null;
  /** Filter cluster — clusterForLocation() result: "nyc" | "remote" | "sf_bay" | "la"
   *  | "boston" | "seattle" | "austin" | "denver" | "chicago" | "other_us" | "other_intl"
   *  | "unknown". Drives the location filter chips and the stat strip. */
  location_cluster: string;
  source: string;
  /** "aggregator" = re-syndicator host (RevOps Careers etc.) — hidden from default views.
   *  "trusted" = original ATS / job board / portfolio board. */
  source_tier: "aggregator" | "trusted";
  score: number;
  /** Provenance of `score` — drives the corner dot on the score pill. */
  scoreProvenance: ScoreProvenance;
  /** True when a heuristic score was clamped down (≤7 for un-enriched roles, ≤3 for
   *  false-positive titles) — i.e. the displayed number is artificially capped. */
  scoreCapped: boolean;
  /** When scoreProvenance === "override", the `reason` from score-overrides.json. */
  scoreOverrideReason?: string;
  status: RoleStatus;
  firstSeen: string;
  publishedDate: string;
  comp: string;
  matchReason: string;
  notes: string;
  stale: boolean;
  closed: boolean;
  enrichment: {
    comp_range?: string;
    stack?: string[];
    team_context?: string;
    green_flags?: string[];
    red_flags?: string[];
    build_component?: boolean;
    ai_signal?: boolean;
    company_stage?: string;
    fit_score?: number;
    verdict?: string;
  } | null;
}

export type SignalResult = "high" | "monitor" | "posting";

export interface Signal {
  slug: string;
  name: string;
  amount: string | null;
  lastChecked: string;
  result: SignalResult;
}

export interface Company {
  name: string;
  slug: string;
  sourceTier: "watched" | "signal" | "scan";
  rolesFound: number;
  signalStatus: SignalResult | null;
  funding: string | null;
  lastActivity: string;
  roles: Role[];
}

export interface ScanStats {
  totalDiscovered: number;
  activelyPursuing: number;
  interviews: number;
  avgScore: number;
  nycCount: number;
  remoteCount: number;
  hasWarmLeads: boolean;
  lastScanDate: string;
}

// ---------------------------------------------------------------------------
// Source Health (/sources page) — see lib/source-health.ts
// ---------------------------------------------------------------------------
export type SourceStatus =
  | "healthy"
  | "broken-extractor" // comp is on the page (audit-confirmed) but we're not pulling it
  | "broken-scrape" //    SPA / scrape failures — high error rate, low fit
  | "quarantined" //      AGGREGATOR_HOSTS — intentionally hidden, kept toggleable
  | "spam-blocked"; //    EXCLUDE_DOMAINS — content-farm, blocked at scan time

/** A per-host finding from the comp-extraction audit (audit/comp-extraction-audit-2026-05-13.md). */
export interface AuditFinding {
  /** 0..1 — sample-derived fraction of this host's "Not listed" rows that are recoverable. */
  recoveryRate: number;
  /** One-line explanation of why comp isn't being extracted from this host. */
  diagnosis: string;
  /** "5a", "5b", … — which numbered fix addresses it ("—" if no fix planned). */
  fixId: string;
  /** Short description of the fix. */
  fixLabel: string;
  /** Exemplar URLs from the audit (the "sample evidence"). */
  sampleUrls: string[];
  /** Which extraction layer the fix targets: "jsonld_basesalary" | "jsonld_description" | "jd_prose" | "page_structured". */
  compSourceTarget: string;
}

export interface SourceHealthRow {
  host: string;
  /** Entries in seen-urls ∪ enrichments for this host. */
  totalUrls: number;
  /** Enrichment entries WITHOUT an `error` key. */
  enrichedReal: number;
  /** Enrichment entries that are { error, timestamp } — total scrape failures. */
  scrapeFailures: number;
  /** enrichedReal / totalUrls. */
  enrichmentRate: number;
  /** scrapeFailures / (enrichedReal + scrapeFailures); 0 if neither. */
  scrapeErrorRate: number;
  /** Mean enrichment.fit_score over enrichedReal; null if none. */
  avgFit: number | null;
  /** Max enrichment.fit_score over enrichedReal; null if none. */
  maxFit: number | null;
  /** Fraction of enrichedReal with fit_score >= 6; null if none. */
  hitRate: number | null;
  /** enrichedReal with a real comp_range (has a $ / digit, not "Not listed" / qualitative). */
  hasCompCount: number;
  /** enrichedReal with comp_range "Not listed" / "None" / empty / qualitative-only. */
  notListedCount: number;
  /** hasCompCount / enrichedReal; 0 if none. */
  hasCompCoverage: number;
  /** round(notListedCount * (auditFinding?.recoveryRate ?? 0)). */
  recoverableCount: number;
  /** (hasCompCount + recoverableCount) / enrichedReal; 0 if none. */
  projectedCompCoverage: number;
  /** Max firstSeen across the host's seen-urls entries (ISO date); "" if unknown. */
  lastSeen: string;
  status: SourceStatus;
  /** null = not yet audited. */
  auditFinding: AuditFinding | null;
  /** Distinct `source` values from seen-urls ("Tier 1: Ashby", "BuiltIn", …), sorted. */
  sourceTags: string[];
}

export interface SourceHealthSummary {
  totalSources: number;
  /** status === "healthy". */
  healthySources: number;
  /** "broken-extractor" + "broken-scrape" — i.e. the active-pipeline hosts that need a fix. */
  brokenSources: number;
  quarantinedSources: number;
  spamBlockedSources: number;
  /** Σ enrichedReal (all hosts). */
  totalEnriched: number;
  /** Σ hasCompCount (all hosts). */
  totalHasComp: number;
  /** Σ notListedCount (all hosts). */
  totalNotListed: number;
  /** totalHasComp / totalEnriched — comp coverage across the whole dataset, today. */
  overallCompCoverage: number;
  /** Σ enrichedReal over active-pipeline hosts only (status not "quarantined"/"spam-blocked"). */
  activeEnriched: number;
  /** Σ hasCompCount over active-pipeline hosts only. */
  activeHasComp: number;
  /** Σ recoverableCount over active-pipeline hosts only — the honest "fix the active pipeline" number. */
  overallRecoverable: number;
  /** (totalHasComp + overallRecoverable) / totalEnriched — headline: where whole-dataset coverage lands if only the active-pipeline hosts get fixed. */
  overallProjectedCoverage: number;
  /** Recoverable on quarantined (aggregator) hosts — surfaced but excluded from the headline (Fix 5b territory). */
  additionalRecoverableQuarantined: number;
  /** Recoverable on spam-blocked hosts — surfaced but excluded from the headline; only meaningful if a host is unquarantined. */
  additionalRecoverableSpam: number;
}
