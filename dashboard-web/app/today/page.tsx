import {
  getRoles,
  getSignals,
  getConfig,
  getLastScanDate,
  getTodaysBriefing,
} from "@/lib/data";
import { computePipelineStats } from "@/lib/stats";
import { TodayPage } from "./today-client";

export const dynamic = "force-dynamic";

export default function Page() {
  // /today is briefing-first, not table-first. We need roles for the stat
  // strip but do NOT call getStats() — that redundantly re-parses all data
  // files. Instead derive hasWarmLeads from signals and lastScanDate from the
  // cheap getLastScanDate() helper.
  const roles = getRoles({ includeAggregator: true });
  const signals = getSignals();
  const config = getConfig();
  const briefing = getTodaysBriefing();

  const hasWarmLeads = signals.some((s) => s.result === "high");
  const lastScanDate = getLastScanDate();

  const stats = computePipelineStats(roles, { hasWarmLeads, lastScanDate });

  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <TodayPage
      briefing={briefing}
      stats={stats}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={hasWarmLeads}
    />
  );
}
