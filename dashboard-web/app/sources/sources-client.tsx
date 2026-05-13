"use client";

import { Activity, ShieldCheck, AlertTriangle, DollarSign, Wrench, ArchiveX } from "lucide-react";
import type { SourceHealthRow, SourceHealthSummary } from "@/lib/types";
import { Shell } from "@/components/Shell";

interface SourcesPageProps {
  rows: SourceHealthRow[];
  summary: SourceHealthSummary;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
  activePursuing: number;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function StatCard({
  icon,
  value,
  label,
  sub,
  color,
  dim,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  sub?: string;
  color: string;
  dim: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg px-4 py-3"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: dim, color }}>
        {icon}
      </div>
      <div>
        <div className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</div>
        <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          {label}
          {sub && <span className="ml-1" style={{ color: "var(--text-muted)" }}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

export function SourcesPage({
  rows,
  summary,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
  activePursuing,
}: SourcesPageProps) {
  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Source Health</h1>
          <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {summary.totalSources} sources &middot; comp coverage {pct(summary.overallCompCoverage)} today &rarr; ~{pct(summary.overallProjectedCoverage)} projected
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard icon={<Activity size={18} />} value={summary.totalSources} label="Sources" sub={`${summary.totalEnriched} enriched`} color="var(--accent)" dim="var(--accent-dim)" />
          <StatCard icon={<ShieldCheck size={18} />} value={summary.healthySources} label="Healthy" color="var(--emerald)" dim="var(--emerald-dim)" />
          <StatCard icon={<AlertTriangle size={18} />} value={summary.brokenSources} label="Broken" sub="extractor + scrape" color="var(--amber)" dim="var(--amber-dim)" />
          <StatCard icon={<DollarSign size={18} />} value={pct(summary.overallCompCoverage)} label="Comp today" sub={`${summary.totalHasComp}/${summary.totalEnriched}`} color="var(--blue)" dim="var(--blue-dim)" />
          <StatCard icon={<Wrench size={18} />} value={`~${pct(summary.overallProjectedCoverage)}`} label="Projected" sub={`+${summary.overallRecoverable} active`} color="var(--violet)" dim="var(--violet-dim)" />
        </div>
        <div className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <ArchiveX size={11} />
          {summary.quarantinedSources} quarantined &middot; {summary.spamBlockedSources} spam-blocked — not in healthy/broken tallies. Headline projection (
          {pct(summary.overallCompCoverage)} &rarr; ~{pct(summary.overallProjectedCoverage)}) covers the active pipeline only;
          +~{summary.additionalRecoverableQuarantined} more roles recoverable on quarantined hosts (Fix 5b), +~{summary.additionalRecoverableSpam} on spam-blocked.
        </div>

        {/* table / filters / expand land in Tasks 8–11 */}
        <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{rows.length} source rows — table coming next.</div>
      </div>
    </Shell>
  );
}
