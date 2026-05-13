import {
  getRoles,
  getSignals,
  getConfig,
  getStats,
  getTodaysBriefing,
} from "@/lib/data";
import { computePipelineStats } from "@/lib/stats";
import { TodayPage } from "./today-client";

export const dynamic = "force-dynamic";

export default function Page() {
  // /today is briefing-first, not table-first — we don't need the full role
  // payload to render. But we *do* need it for the secondary stat strip at the
  // bottom and for the Shell's sidebar badges (activePursuing, etc.). Read once
  // here, compute everything server-side, hand the client a small payload.
  const roles = getRoles({ includeAggregator: true });
  const signals = getSignals();
  const config = getConfig();
  const scanStats = getStats();
  const briefing = getTodaysBriefing();

  const stats = computePipelineStats(roles, {
    hasWarmLeads: scanStats.hasWarmLeads,
    lastScanDate: scanStats.lastScanDate,
  });

  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <TodayPage
      briefing={briefing}
      stats={stats}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={scanStats.hasWarmLeads}
    />
  );
}
