import type { Role, ScanStats } from "./types";

/**
 * Pipeline stat computation, factored out so /today (server-side, roles
 * are static) and /pipeline (client-side, roles mutate on status edits)
 * can share the exact same logic. Keep this in sync — any future stat
 * the hero strip needs goes here, not in either consumer.
 *
 * Aggregator-tier roles (re-syndicated noise) are filtered out for every
 * KPI; including them inflates counts and drags the average down.
 */
export function computePipelineStats(
  roles: Role[],
  serverMeta: { hasWarmLeads: boolean; lastScanDate: string }
): ScanStats {
  const r0 = roles.filter((r) => r.source_tier !== "aggregator");
  const active = r0.filter((r) => r.status !== "Rejected" && r.status !== "Skipped");
  const pursuing = active.filter((r) => r.status !== "Discovered");
  const interviews = r0.filter((r) => r.status === "Interview");
  const offers = r0.filter((r) => r.status === "Offer");
  const scores = r0.map((r) => r.score).filter((s) => s > 0);
  const avgScore =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;

  const actionable = r0.filter((r) => r.score >= 4);

  return {
    totalDiscovered: actionable.length,
    activelyPursuing: pursuing.length,
    interviews: interviews.length,
    offers: offers.length,
    avgScore,
    nycCount: r0.filter((r) => r.location_cluster === "nyc").length,
    remoteCount: r0.filter((r) => r.location_cluster === "remote").length,
    hasWarmLeads: serverMeta.hasWarmLeads,
    lastScanDate: serverMeta.lastScanDate,
  };
}
