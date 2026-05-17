import { getSignals, getRoles, getStats, getConfig } from "@/lib/data";
import { getSignalMatches, getExcludedCompanies } from "@/lib/signal-enrichment";
import type { EnrichedSignal } from "@/lib/signal-enrichment";
import { SignalsPage } from "./signals-client";

export const dynamic = "force-dynamic";

export default function Page() {
  const signals = getSignals();
  const roles = getRoles();
  const stats = getStats();
  const config = getConfig();

  // Archetype matching + hiring velocity
  const matches = getSignalMatches(signals);
  const excluded = getExcludedCompanies();

  // Cross-reference: find signals whose companies also have posted roles
  const roleCompanies = new Set(
    roles.map((r) => r.company.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );

  // Enrich signals with match data
  const enriched: EnrichedSignal[] = signals.map((s) => ({
    ...s,
    match: matches.get(s.slug) ?? {
      archetypes_matched: [],
      archetype_roles_count: 0,
      total_roles: 0,
      open_roles_count: 0,
      hiring_velocity: "cold" as const,
      has_pipeline_roles: false,
      match_status: "unknown" as const,
    },
  }));

  // Categorize into new hierarchy sections
  const dismissed = new Set([...excluded]);

  // Section 1: Acting On Now — confirmed archetype match + active signals
  const actingOnNow = enriched.filter(
    (s) =>
      !dismissed.has(s.slug) &&
      (s.match.match_status === "confirmed_match" ||
        (s.match.hiring_velocity !== "cold" && s.match.archetypes_matched.length > 0))
  );

  // Section 2: Warming Up — signal=high or posting, not yet confirmed match
  const warmingUp = enriched.filter(
    (s) =>
      !dismissed.has(s.slug) &&
      !actingOnNow.includes(s) &&
      (s.result === "high" || s.result === "posting" || roleCompanies.has(s.slug.replace(/[^a-z0-9]/g, "")))
  );

  // Section 3: Monitor — signal=monitor, not filtered out
  const monitor = enriched.filter(
    (s) =>
      !dismissed.has(s.slug) &&
      !actingOnNow.includes(s) &&
      !warmingUp.includes(s) &&
      s.match.match_status !== "confirmed_no_match"
  );

  // Section 4: Hidden by Filter — confirmed_no_match OR user-dismissed
  const hidden = enriched.filter(
    (s) =>
      dismissed.has(s.slug) || s.match.match_status === "confirmed_no_match"
  );

  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <SignalsPage
      actingOnNow={actingOnNow}
      warmingUp={warmingUp}
      monitor={monitor}
      hidden={hidden}
      totalSignals={signals.length}
      actingCount={actingOnNow.length}
      warmingCount={warmingUp.length}
      monitorCount={monitor.length}
      hiddenCount={hidden.length}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={stats.hasWarmLeads}
      activePursuing={stats.activelyPursuing}
      highConviction={actingOnNow.length + warmingUp.length}
    />
  );
}
