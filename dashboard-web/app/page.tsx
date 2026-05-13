import { getRoles, getSignals, getConfig, getStats } from "@/lib/data";
import { PipelinePage } from "./pipeline-client";

export const dynamic = "force-dynamic";

export default function Page() {
  const roles = getRoles();
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
