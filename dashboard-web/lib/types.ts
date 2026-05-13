export type RoleStatus =
  | "Discovered"
  | "Evaluated"
  | "Applied"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Skipped";

export interface Role {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string;
  source: string;
  score: number;
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
