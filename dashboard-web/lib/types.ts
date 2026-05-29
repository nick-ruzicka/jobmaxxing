export type RoleStatus =
  | "Discovered"
  | "Evaluated"
  | "Applied"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Skipped";

/** Where a role's score came from, in trust order:
 *  "override"             — manual eval override from data/score-overrides.json (wins over everything)
 *  "application"          — pulled from the application tracker (applications.md)
 *  "enriched"             — Claude + G4 engine adjustment layer (enrichment.score_adjusted)
 *  "enriched_base_only"   — base Claude score with no engine layer (enrichment.score_base) — backfill remnant
 *  "enriched_raw_claude"  — raw Claude verdict only (enrichment.fit_score) — pre-G4 record
 *  "heuristic"            — title/location/company keyword math, no JD read (scan report or computeScore) */
export type ScoreProvenance =
  | "override"
  | "enriched"
  | "enriched_base_only"
  | "enriched_raw_claude"
  | "application"
  | "heuristic";

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
  /** E4: when the engine floor-clamped this role to 0, the dominant negative
   *  adjustment that killed it (e.g. "location:onsite_international (-75)").
   *  Present only on enriched score===0 roles — distinguishes "great role,
   *  wrong location" from genuine low-fit. */
  clampReason?: string;
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
    /** Raw Claude verdict score (0–10). Pre-G4 records only carry this; newer
     *  records also have score_base + score_adjusted. */
    fit_score?: number;
    /** Engine layer base score before adjustments (G4: location/comp/archetype/soft/anti). */
    score_base?: number;
    /** Engine layer final score after G4 adjustments. This is what the dashboard
     *  prefers for display when present. */
    score_adjusted?: number;
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

// ---------------------------------------------------------------------------
// Daily briefing (/today, /sources) — shape produced by scripts/generate-briefing.mjs
// and scripts/generate-pipeline-health.mjs. Read on the server, rendered by
// MorningBriefing and PipelineHealthBriefing.
// ---------------------------------------------------------------------------

/** Categories the agent emits. Each maps to an icon + tone in MorningBriefing. */
export type BriefingItemType =
  | "interview"
  | "apply"
  | "follow_up"
  | "missed"
  | "stale"
  | "verify_location"
  | "recalibrate"
  // Pipeline Health categories (Task 4) — share the same render but different tone.
  | "extractor_regression"
  | "new_pattern"
  | "label_opportunity"
  | "command_suggestion";

/**
 * Per-item context payload populated by the briefing generator and consumed
 * by the chat panel + the inline-detail render. Per the AI feature audit
 * (docs/audits/2026-05-28-ai-feature-audit.md §4): this used to be a free-form
 * `Record<string, unknown>`, which is the root cause of the deep-link bug
 * class. Now typed explicitly for the fields the generator actually emits.
 *
 * The trailing index signature is preserved so the generator can attach new
 * fields ahead of consumers without breaking the type (forward-compat).
 *
 * Generator contract per scripts/generate-briefing.mjs prompt:
 *   - "apply"/"missed"/"recalibrate" items: { url, company, role, fit_score, comp_range, stack, verdict_excerpt }
 *   - "follow_up" items:                    { company, role, days_stale, status, draft_message }
 *   - "verify_location" items:              { url, company, role, location_string }
 */
export interface BriefingItemContext {
  /** Canonical role URL — the apply / JD link. Use for "Open JD". */
  url?: string;
  /** Company name as it appears in the briefing copy (e.g. "Anthropic"). */
  company?: string;
  /**
   * Normalized slug derived from company. Used for deep-linking into
   * /pipeline?company=<slug>&from=briefing and /companies/<slug>. May be
   * absent on older briefings; consumers derive locally as fallback.
   */
  company_slug?: string;
  /** Role title as shown in the briefing. */
  role?: string;
  fit_score?: number;
  comp_range?: string;
  stack?: string[];
  verdict_excerpt?: string;
  draft_message?: string;
  days_stale?: number;
  status?: string;
  location_string?: string;
  /** Forward-compat: generator may attach new fields ahead of consumers. */
  [key: string]: unknown;
}

export interface BriefingItem {
  type: BriefingItemType;
  title: string;
  subtitle?: string;
  /** Inline call-to-action — when both fields are set, an arrow link renders. */
  action_label?: string;
  action_href?: string;
  /** Item-specific context payload (see BriefingItemContext above for the
   *  generator contract). The chat panel uses this to scope a conversation
   *  to the item; the inline-detail render uses it for fields + deep links. */
  context?: BriefingItemContext;
}

export interface Briefing {
  /** YYYY-MM-DD — also the filename slug under data/briefings/. */
  date: string;
  /** ISO timestamp from the generator run. */
  generated_at: string;
  items: BriefingItem[];
}

export interface ScanStats {
  totalDiscovered: number;
  activelyPursuing: number;
  interviews: number;
  /** Roles in the Offer state. Used by the Pipeline hero strip. */
  offers: number;
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
