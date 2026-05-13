import { getRoles, getSignals, getConfig, getStats } from "@/lib/data";
import { PipelinePage } from "./pipeline-client";

export const dynamic = "force-dynamic";

export default function Page() {
  // Fetch *all* roles (incl. aggregator-sourced) so the pipeline view can offer an
  // "Include aggregator results" toggle; the table hides source_tier:"aggregator" by default
  // and the stat strip computes from the non-aggregator subset.
  const roles = getRoles({ includeAggregator: true });
  const signals = getSignals();
  const config = getConfig();
  const stats = getStats();

  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <PipelinePage
      roles={roles}
      serverMeta={{
        hasWarmLeads: stats.hasWarmLeads,
        lastScanDate: stats.lastScanDate,
      }}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
    />
  );
}
