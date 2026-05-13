"use client";

import { useState, useMemo } from "react";
import type { Role, RoleStatus, ScanStats } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { StatStrip } from "@/components/StatStrip";
import { PipelineTable } from "@/components/PipelineTable";

interface PipelinePageProps {
  roles: Role[];
  serverMeta: { hasWarmLeads: boolean; lastScanDate: string };
  highConviction: number;
  companyCount: number;
  signalCount: number;
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
    const active = roles.filter((r) => r.status !== "Rejected" && r.status !== "Skipped");
    const pursuing = active.filter((r) => r.status !== "Discovered");
    const interviews = roles.filter((r) => r.status === "Interview");
    const scores = roles.map((r) => r.score).filter((s) => s > 0);
    const avgScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;

    const actionable = roles.filter((r) => r.score >= 4);

    return {
      totalDiscovered: actionable.length,
      activelyPursuing: pursuing.length,
      interviews: interviews.length,
      avgScore,
      nycCount: roles.filter((r) => r.location.includes("NYC")).length,
      remoteCount: roles.filter((r) => r.location.toLowerCase().includes("remote")).length,
      hasWarmLeads: serverMeta.hasWarmLeads,
      lastScanDate: serverMeta.lastScanDate,
    };
  }, [roles, serverMeta]);

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
      <div className="space-y-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Pipeline</h1>
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
