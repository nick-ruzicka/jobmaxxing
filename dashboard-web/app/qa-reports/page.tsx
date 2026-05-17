// /qa-reports — PersonaLab dashboard surface.
//
// Server-side: reads from qa/ on every request (force-dynamic) so a fresh
// orchestrator run shows up immediately. Hands a single QaReportsData
// object plus sidebar-counter props to the client component.

import { join } from "path";

import { getRoles, getSignals, getConfig, getStats } from "@/lib/data";
import { computePipelineStats } from "@/lib/stats";
import { defaultQaPaths, loadQaReportsData } from "@/lib/qa-reports";

import { QaReportsClient } from "./qa-reports-client";

export const dynamic = "force-dynamic";

function repoRoot(): string {
  return join(process.cwd(), "..");
}

export default function Page() {
  // Sidebar / Shell wants the same counter set as every other page.
  const roles = getRoles({ includeAggregator: true });
  const signals = getSignals();
  const config = getConfig();
  const scanStats = getStats();
  const pipelineStats = computePipelineStats(roles, {
    hasWarmLeads: scanStats.hasWarmLeads,
    lastScanDate: scanStats.lastScanDate,
  });
  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  const data = loadQaReportsData(defaultQaPaths(repoRoot()));

  return (
    <QaReportsClient
      data={data}
      activePursuing={pipelineStats.activelyPursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={scanStats.hasWarmLeads}
    />
  );
}
