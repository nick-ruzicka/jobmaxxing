import {
  getRoles,
  getSignals,
  getConfig,
  getLastScanDate,
  getTodaysBriefing,
} from "@/lib/data";
import { PipelinePage } from "./pipeline-client";

export const dynamic = "force-dynamic";

export default function Page() {
  // Fetch *all* roles (incl. aggregator-sourced) so the pipeline view can offer an
  // "Include aggregator results" toggle; the table hides source_tier:"aggregator" by default
  // and the stat strip computes from the non-aggregator subset.
  const roles = getRoles({ includeAggregator: true });
  const signals = getSignals();
  const config = getConfig();
  // Today's briefing — rendered as a top panel above the table per the AI
  // feature audit Step 2. Null when the generator hasn't run yet today.
  const briefing = getTodaysBriefing();

  const hasWarmLeads = signals.some((s) => s.result === "high");
  const lastScanDate = getLastScanDate();
  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <PipelinePage
      roles={roles}
      serverMeta={{ hasWarmLeads, lastScanDate }}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      briefing={briefing}
    />
  );
}
