"use client";

import { useState, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, Radio, ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { Role, RoleStatus, ScanStats } from "@/lib/types";
import { computePipelineStats } from "@/lib/stats";
import { Shell } from "@/components/Shell";
import { StatStrip } from "@/components/StatStrip";
import { PipelineTable } from "@/components/PipelineTable";
import { PageHeader, Button, Toast, type ToastKind } from "@/components/ui";
import { useScan } from "@/components/ScanContext";

// Toast lifecycle, in ms. Fade-out begins LIFETIME_MS - FADE_MS so the
// 300ms opacity transition completes exactly as the node unmounts.
const TOAST_LIFETIME_MS = 3000;
const TOAST_FADE_MS = 300;

type ToastEntry = { id: number; kind: ToastKind; message: string; removing: boolean };

interface PipelinePageProps {
  roles: Role[];
  serverMeta: { hasWarmLeads: boolean; lastScanDate: string };
  highConviction: number;
  companyCount: number;
  signalCount: number;
}

/** Lives inside <Shell> so it can read the scan controls from context. */
function PipelineHeader({ roleCount, lastScanDate }: { roleCount: number; lastScanDate: string }) {
  const { runScan, scanRunning } = useScan();
  return (
    <PageHeader
      title="Pipeline"
      subtitle={`${roleCount} ${roleCount === 1 ? "role" : "roles"}`}
      actions={
        <>
          {lastScanDate && (
            // Demoted from a stat card to incidental metadata — it's not a KPI,
            // it's a freshness marker on the action that produced the data.
            <span className="mr-1 hidden text-[12px] tabular-nums text-text-muted sm:inline">
              Last scan: {lastScanDate}
            </span>
          )}
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
  const searchParams = useSearchParams();
  const companyFilter = searchParams.get("company") || "";
  const fromSignals = searchParams.get("from") === "signals";

  const [roles, setRoles] = useState(initialRoles);

  // Stats recompute on roles mutation (status edits drag rows between buckets).
  const stats: ScanStats = useMemo(
    () => computePipelineStats(roles, serverMeta),
    [roles, serverMeta]
  );

  // Header count: the non-aggregator pipeline size (stable; the filter bar shows the filtered count).
  const pipelineCount = useMemo(
    () => roles.filter((r) => r.source_tier !== "aggregator").length,
    [roles]
  );

  // Toast queue. Each toast lives in `toasts`, has a fade-out flag flipped at
  // LIFETIME-FADE and is removed at LIFETIME. nextToastId is a ref so the IDs
  // are unique even when toasts fire back-to-back within the same tick.
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextToastId = useRef(1);

  function pushToast(kind: ToastKind, message: string) {
    const id = nextToastId.current++;
    setToasts((prev) => [...prev, { id, kind, message, removing: false }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)));
    }, TOAST_LIFETIME_MS - TOAST_FADE_MS);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_LIFETIME_MS);
  }

  async function handleStatusChange(url: string, status: RoleStatus) {
    const role = roles.find((r) => r.url === url);
    const prevStatus = role?.status;
    // Optimistic local update — keep the UI responsive whether the network
    // call succeeds or not. The toast is the truthful signal.
    setRoles((prev) => prev.map((r) => (r.url === url ? { ...r, status } : r)));
    try {
      const res = await fetch("/api/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, status, company: role?.company, title: role?.title }),
      });
      if (!res.ok) throw new Error(`update-status returned ${res.status}`);
      if (prevStatus && prevStatus !== status) {
        pushToast("success", `Status updated: ${prevStatus} → ${status}`);
      }
    } catch {
      pushToast("error", "Couldn't save — retry?");
    }
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
      <PipelineHeader roleCount={pipelineCount} lastScanDate={stats.lastScanDate} />
      <div className="space-y-6">
        {fromSignals && (
          <div className="flex flex-col gap-1">
            <Link href="/signals" className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-secondary transition-colors">
              <ArrowLeft size={12} />
              Back to Signals
            </Link>
            {/* ISSUE-005: when you arrive from a signal card we cleared the
                default 4+ score filter so every canonical role for that
                company shows. Otherwise low-scored roles get hidden by a
                default the user never chose, defeating the point of the
                signal link. */}
            <span className="text-[12px] text-text-muted">
              Showing all roles · default score filter cleared
            </span>
          </div>
        )}
        <StatStrip stats={stats} />
        <PipelineTable
          roles={roles}
          onStatusChange={handleStatusChange}
          onNotesChange={handleNotesChange}
          initialSearch={companyFilter}
          defaultMinScore={fromSignals ? 0 : 4}
        />
      </div>

      {/* Toast queue — fixed bottom-right, stacks newest-on-top. Lives outside
          the scrollable container so it stays put as the user scrolls the table. */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-atomic="false"
          className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
        >
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto">
              <Toast kind={t.kind} message={t.message} removing={t.removing} />
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
