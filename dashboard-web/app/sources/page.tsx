import { getSourceHealth } from "@/lib/source-health";
import { getSignals, getStats, getConfig } from "@/lib/data";
import { SourcesPage } from "./sources-client";

export const dynamic = "force-dynamic";

export default function Page() {
  const { rows, summary } = getSourceHealth();
  const signals = getSignals();
  const stats = getStats();
  const config = getConfig();
  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;
  return (
    <SourcesPage
      rows={rows}
      summary={summary}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={stats.hasWarmLeads}
      activePursuing={stats.activelyPursuing}
    />
  );
}
