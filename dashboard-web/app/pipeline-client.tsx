"use client";

import { useState, useMemo } from "react";
import { RefreshCw, Radio } from "lucide-react";
import type { Role, RoleStatus, ScanStats } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { StatStrip } from "@/components/StatStrip";
import { PipelineTable } from "@/components/PipelineTable";
import { PageHeader, Button } from "@/components/ui";
import { useScan } from "@/components/ScanContext";

interface PipelinePageProps {
  roles: Role[];
  serverMeta: { hasWarmLeads: boolean; lastScanDate: string };
  highConviction: number;
  companyCount: number;
  signalCount: number;
}

/** Lives inside <Shell> so it can read the scan controls from context. */
function PipelineHeader({ roleCount }: { roleCount: number }) {
  const { runScan, scanRunning } = useScan();
  return (
    <PageHeader
      title="Pipeline"
      subtitle={`${roleCount} ${roleCount === 1 ? "role" : "roles"}`}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => runScan("scan")}
            disabled={scanRunning}
            title="Job boards + Exa + Similar"
          >
            <RefreshCw size={14} className={scanRunning ? "animate-spin" : ""} />
            Run Scan
          </Button>
          <Button
            variant="secondary"
            onClick={() => runScan("signal")}
            disabled={scanRunning}
            title="Funding + hiring-intent signals"
          >
            <Radio size={14} />
            Signal Scan
          </Button>
        </>
      }
    />
  );
}

export function PipelinePage({
  roles: initialRoles,
  serverMeta,
  highConviction,
  companyCount,
  signalCount,
}: PipelinePageProps) {
  const [roles, setRoles] = useState(initialRoles);

  const stats: ScanStats = useMemo(() => {
    // Stat strip always reflects the non-aggregator pipeline (aggregator results are
    // re-syndicated noise; including them inflates counts and tanks the average).
    const r0 = roles.filter((r) => r.source_tier !== "aggregator");
    const active = r0.filter((r) => r.status !== "Rejected" && r.status !== "Skipped");
    const pursuing = active.filter((r) => r.status !== "Discovered");
    const interviews = r0.filter((r) => r.status === "Interview");
    const scores = r0.map((r) => r.score).filter((s) => s > 0);
    const avgScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;

    const actionable = r0.filter((r) => r.score >= 4);

    return {
      totalDiscovered: actionable.length,
      activelyPursuing: pursuing.length,
      interviews: interviews.length,
      avgScore,
      nycCount: r0.filter((r) => r.location_cluster === "nyc").length,
      remoteCount: r0.filter((r) => r.location_cluster === "remote").length,
      hasWarmLeads: serverMeta.hasWarmLeads,
      lastScanDate: serverMeta.lastScanDate,
    };
  }, [roles, serverMeta]);

  // Header count: the non-aggregator pipeline size (stable; the filter bar shows the filtered count).
  const pipelineCount = useMemo(
    () => roles.filter((r) => r.source_tier !== "aggregator").length,
    [roles]
  );

  function handleStatusChange(url: string, status: RoleStatus) {
    const role = roles.find((r) => r.url === url);
    setRoles((prev) => prev.map((r) => (r.url === url ? { ...r, status } : r)));
    fetch("/api/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, status, company: role?.company, title: role?.title }),
    }).catch(() => {});
  }

  function handleNotesChange(url: string, notes: string) {
    setRoles((prev) => prev.map((r) => (r.url === url ? { ...r, notes } : r)));
  }

  return (
    <Shell
      activePursuing={stats.activelyPursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={serverMeta.hasWarmLeads}
    >
      <PipelineHeader roleCount={pipelineCount} />
      <div className="space-y-6">
        <StatStrip stats={stats} />
        <PipelineTable
          roles={roles}
          onStatusChange={handleStatusChange}
          onNotesChange={handleNotesChange}
        />
      </div>
    </Shell>
  );
}
