// Presentational helpers for the /companies/[slug] page. Pure functions so
// they can be unit-tested in vitest (the project doesn't run React component
// tests yet — see WORK_LOG_COMPANIES_DRILLDOWN.md).

import type { BadgeColor } from "@/components/ui";
import type { EnrichmentSummary, HiringVelocity } from "./company-detail";

const ARCHETYPE_LABELS: Record<string, string> = {
  "gtm-engineering": "GTM Eng",
  "ai-operations": "AI Ops",
  "fde": "FDE",
  "web3-bd": "Web3 BD",
  "web3-bizops": "Web3 BizOps",
};

/**
 * Velocity → Badge color + label. Returns null when there's nothing to show
 * (i.e. `cold` — we don't render a "COLD" pill).
 */
export function velocityBadge(
  v: HiringVelocity
): { color: BadgeColor; label: string } | null {
  if (v === "on_fire") return { color: "red", label: "ON FIRE" };
  if (v === "hot") return { color: "amber", label: "HOT" };
  if (v === "warming") return { color: "blue", label: "WARMING" };
  return null;
}

/** Short display name for an archetype id, falling back to the raw id. */
export function archetypeLabel(id: string): string {
  return ARCHETYPE_LABELS[id] ?? id;
}

/** Convert a boolean to the plain English label used in summary panels. */
export function yesNoLabel(v: boolean): string {
  return v ? "Yes" : "No";
}

/**
 * Build a short subtitle line for the page header summarizing funding state.
 * Returns null when there's no funding info at all (signal-only line is then
 * dropped from the header subtitle).
 */
export function fundingSubtitle(
  amount: string | null,
  date: string | null
): string | null {
  if (!amount && !date) return null;
  if (!amount) return null;
  if (date) return `${amount} raised · seen ${date}`;
  return `${amount} raised`;
}

/**
 * True if any enrichment_summary field has content. Used to choose between
 * rendering the summary cards vs. the "No enriched roles yet" empty state.
 */
export function hasAnyEnrichment(s: EnrichmentSummary): boolean {
  return (
    s.green_flags.length > 0 ||
    s.red_flags.length > 0 ||
    s.team_context.length > 0 ||
    s.company_stage !== null ||
    s.build_component.length > 0 ||
    s.ai_signal.length > 0
  );
}
