export type RoleStatus =
  | "Discovered"
  | "Evaluated"
  | "Applied"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Skipped";

/** Where a role's score came from, in trust order:
 *  "enriched"    — Claude analyzed the JD (enrichment.fit_score)
 *  "application" — pulled from the application tracker (applications.md)
 *  "heuristic"   — title/location/company keyword math, no JD read (scan report or computeScore)
 *  ("override" will join this once score-overrides.json is wired in — Fix #4) */
export type ScoreProvenance = "enriched" | "application" | "heuristic";

export interface Role {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string;
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
