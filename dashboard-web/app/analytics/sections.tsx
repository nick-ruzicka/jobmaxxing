/**
 * sections.tsx — the eight content sections of /analytics, plus shared helpers.
 *
 * Each section is its own export so the page file stays a thin shell. All of
 * them accept already-fetched data (no I/O inside this file) so they're easy
 * to mock for snapshot tests later.
 */

"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Activity,
  DollarSign,
  Target,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sparkline } from "./Sparkline";

import type {
  Anomaly,
  DailySeries,
  SourceAggregate,
  TierAggregate,
  AggregatedTotals,
  SurfacedAnomaly,
  DataCompleteness,
} from "@/lib/analytics";

// -----------------------------------------------------------------------------
// 1. Hero metrics
// -----------------------------------------------------------------------------

export function HeroMetrics({ totals }: { totals: AggregatedTotals }) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={<DollarSign className="h-3.5 w-3.5" />}
        label={`Total cost (${totals.range})`}
        value={fmtUsd(totals.total_cost_usd)}
        sub={`Claude ${fmtUsd(totals.claude_cost_usd)} + Exa ${fmtUsd(totals.exa_cost_usd)}`}
      />
      <StatCard
        icon={<Target className="h-3.5 w-3.5" />}
        label="Cost per high-fit role"
        value={totals.cost_per_high_fit_role !== null ? fmtUsd(totals.cost_per_high_fit_role) : "—"}
        sub={`${fmtInt(totals.roles_fit_6plus)} fit≥6 roles`}
      />
      <StatCard
        icon={<Sparkles className="h-3.5 w-3.5" />}
        label="Cost per application"
        value={totals.cost_per_application !== null ? fmtUsd(totals.cost_per_application) : "—"}
        sub={`${fmtInt(totals.applications_attributed)} applications attributed`}
      />
      <StatCard
        icon={<Activity className="h-3.5 w-3.5" />}
        label="Pipeline efficiency"
        value={`${fmtInt(totals.roles_discovered)} → ${fmtInt(totals.roles_fit_6plus)}`}
        sub={
          totals.roles_discovered > 0
            ? `${pct(totals.roles_fit_6plus / totals.roles_discovered)} reach fit≥6`
            : "no discoveries yet"
        }
      />
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <div className="flex items-center gap-1.5 text-text-tertiary">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-[0.04em]">{label}</span>
      </div>
      <div className="mt-2 text-[22px] font-bold tabular-nums tracking-[-0.02em] text-text-primary">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-text-muted">{sub}</div>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 2. Anomalies banner / panel
// -----------------------------------------------------------------------------

export function AnomaliesPanel({ anomalies }: { anomalies: SurfacedAnomaly[] }) {
  const [open, setOpen] = useState(true);
  const high = anomalies.filter((a) => a.severity === "high");
  if (anomalies.length === 0) {
    return (
      <section className="rounded-lg border border-emerald-border bg-emerald-dim/40 p-3 text-[13px] text-emerald">
        ✓ No anomalies in the last 7 days. Scraper is behaving.
      </section>
    );
  }
  return (
    <section
      className={`rounded-lg border ${high.length > 0 ? "border-red-border bg-red-dim/40" : "border-amber-border bg-amber-dim/30"}`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[14px] font-medium text-text-primary">
          <AlertTriangle
            className={`h-4 w-4 ${high.length > 0 ? "text-red" : "text-amber"}`}
          />
          {anomalies.length} anomal{anomalies.length === 1 ? "y" : "ies"} active
          {high.length > 0 && (
            <Badge color="red">
              {high.length} high
            </Badge>
          )}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-text-tertiary" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-tertiary" />
        )}
      </button>
      {open && (
        <div className="border-t border-border-subtle">
          {anomalies.map((a, i) => (
            <AnomalyRow key={i} a={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function AnomalyRow({ a }: { a: SurfacedAnomaly }) {
  const color: "red" | "amber" | "neutral" =
    a.severity === "high" ? "red" : a.severity === "medium" ? "amber" : "neutral";
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-3 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
          <Badge color={color}>{a.severity}</Badge>
          <span className="font-mono text-[12px] text-text-secondary">{a.type}</span>
          {a.source && (
            <Link
              href={`/analytics/${encodeURIComponent(a.source)}`}
              className="text-[12px] text-accent hover:underline"
            >
              {a.source}
            </Link>
          )}
        </div>
        <div className="mt-1 text-[13px] text-text-secondary">{a.suggested_action}</div>
        <div className="mt-1 text-[11px] text-text-muted">
          first seen {a.first_seen} · last seen {a.last_seen} · {a.occurrence_count}× occurred
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 3. Source performance table
// -----------------------------------------------------------------------------

type SortKey =
  | "roles_discovered"
  | "hit_rate_fit_6plus"
  | "total_cost_usd"
  | "cost_per_high_fit"
  | "applications_attributed"
  | "has_comp_coverage"
  | "host";

type SourceFilter = "all" | "active" | "high_hit" | "has_apps" | "has_cost" | "has_errors";

const FILTER_LABELS: Record<SourceFilter, string> = {
  all: "All",
  active: "Active",
  high_hit: "Hit rate ≥30%",
  has_apps: "Has apps",
  has_cost: "Has cost",
  has_errors: "Has errors",
};

function matchesFilter(f: SourceFilter, s: SourceAggregate): boolean {
  switch (f) {
    case "all":
      return true;
    case "active":
      return s.roles_enriched > 0;
    case "high_hit":
      return s.roles_enriched >= 5 && s.hit_rate_fit_6plus >= 0.3;
    case "has_apps":
      return (s.applications_attributed || 0) > 0;
    case "has_cost":
      return (s.total_cost_usd || 0) > 0;
    case "has_errors":
      return s.http_error_count > 0 || s.enrich_errors > 0;
  }
}

const DEFAULT_VISIBLE = 10;

export function SourcePerformance({ sources }: { sources: SourceAggregate[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("roles_discovered");
  const [desc, setDesc] = useState(true);
  const [filter, setFilter] = useState<SourceFilter>("active");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(
    () => sources.filter((s) => matchesFilter(filter, s)),
    [sources, filter],
  );

  const sorted = useMemo(() => {
    const c = [...filtered];
    c.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number | string;
      const bv = (b[sortKey] ?? 0) as number | string;
      if (typeof av === "string" || typeof bv === "string") {
        return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      }
      return desc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return c;
  }, [filtered, sortKey, desc]);

  if (sources.length === 0) {
    return <EmptyState title="No source data for this range." />;
  }

  const visible = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
  const hidden = sorted.length - visible.length;

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="mr-1 text-text-muted">Filter:</span>
        {(Object.keys(FILTER_LABELS) as SourceFilter[]).map((f) => {
          const count = sources.filter((s) => matchesFilter(f, s)).length;
          const active = f === filter;
          return (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setExpanded(false);
              }}
              className={
                active
                  ? "inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-dim px-2 py-0.5 font-medium text-accent"
                  : "inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2 py-0.5 text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
              }
            >
              {FILTER_LABELS[f]}
              <span className="text-[10px] tabular-nums text-text-muted">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-2">
        <table className="w-full text-[13px]">
          <thead className="border-b border-border-subtle bg-surface-1 text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
            <tr>
              <SortableTh col="host" sortKey={sortKey} desc={desc} onClick={(k) => toggleSort(k, sortKey, desc, setSortKey, setDesc)}>
                Source
              </SortableTh>
              <SortableTh col="roles_discovered" sortKey={sortKey} desc={desc} onClick={(k) => toggleSort(k, sortKey, desc, setSortKey, setDesc)} align="right">
                Roles
              </SortableTh>
              <SortableTh col="hit_rate_fit_6plus" sortKey={sortKey} desc={desc} onClick={(k) => toggleSort(k, sortKey, desc, setSortKey, setDesc)} align="right">
                Hit rate
              </SortableTh>
              <SortableTh col="has_comp_coverage" sortKey={sortKey} desc={desc} onClick={(k) => toggleSort(k, sortKey, desc, setSortKey, setDesc)} align="right">
                Comp cov
              </SortableTh>
              <SortableTh col="total_cost_usd" sortKey={sortKey} desc={desc} onClick={(k) => toggleSort(k, sortKey, desc, setSortKey, setDesc)} align="right">
                Cost
              </SortableTh>
              <SortableTh col="cost_per_high_fit" sortKey={sortKey} desc={desc} onClick={(k) => toggleSort(k, sortKey, desc, setSortKey, setDesc)} align="right">
                $/fit≥6
              </SortableTh>
              <SortableTh col="applications_attributed" sortKey={sortKey} desc={desc} onClick={(k) => toggleSort(k, sortKey, desc, setSortKey, setDesc)} align="right">
                Apps
              </SortableTh>
              <th className="px-3 py-2.5 text-right">HTTP err</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const hr = s.hit_rate_fit_6plus;
              const hrColor: "emerald" | "amber" | "red" | "neutral" =
                s.roles_enriched < 5 ? "neutral" : hr >= 0.3 ? "emerald" : hr >= 0.1 ? "amber" : "red";
              const cc = s.has_comp_coverage ?? 0;
              const ccColor: "emerald" | "amber" | "red" | "neutral" =
                s.roles_enriched < 5 ? "neutral" : cc >= 0.6 ? "emerald" : cc >= 0.3 ? "amber" : "red";
              return (
                <tr
                  key={s.host}
                  className="border-b border-border-subtle even:bg-surface-row hover:bg-surface-3"
                >
                  <td className="px-3 py-2.5 font-medium text-text-primary">
                    <Link
                      href={`/analytics/${encodeURIComponent(s.host)}`}
                      className="hover:text-accent hover:underline"
                    >
                      {s.host}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {fmtInt(s.roles_discovered)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Badge color={hrColor}>
                      {s.roles_enriched > 0 ? pct(hr) : "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Badge color={ccColor}>
                      {s.roles_enriched > 0 ? pct(cc) : "—"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {fmtUsd(s.total_cost_usd)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {s.cost_per_high_fit !== null ? fmtUsd(s.cost_per_high_fit) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {fmtInt(s.applications_attributed || 0)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">
                    {fmtInt(s.http_error_count)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[12px] text-accent hover:underline"
        >
          Show {hidden} more {hidden === 1 ? "source" : "sources"} ▾
        </button>
      )}
      {expanded && sorted.length > DEFAULT_VISIBLE && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[12px] text-text-tertiary hover:text-text-secondary"
        >
          Collapse to top {DEFAULT_VISIBLE} ▴
        </button>
      )}
    </div>
  );
}

function SortableTh({
  col,
  sortKey,
  desc,
  onClick,
  align = "left",
  children,
}: {
  col: SortKey;
  sortKey: SortKey;
  desc: boolean;
  onClick: (col: SortKey) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = col === sortKey;
  return (
    <th
      className={`px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"} ${
        active ? "text-text-primary" : ""
      }`}
    >
      <button
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 ${
          active ? "text-text-primary" : "text-text-tertiary hover:text-text-secondary"
        }`}
      >
        {children}
        {active && (desc ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function toggleSort(
  k: SortKey,
  current: SortKey,
  desc: boolean,
  setKey: (k: SortKey) => void,
  setDesc: (d: boolean) => void,
) {
  if (k === current) setDesc(!desc);
  else {
    setKey(k);
    setDesc(true);
  }
}

// -----------------------------------------------------------------------------
// 4. Cost trends — four sparklines
// -----------------------------------------------------------------------------

export function CostTrends({ daily }: { daily: DailySeries[] }) {
  if (daily.length === 0) {
    return (
      <EmptyState title="No cost data yet. Trends populate after the first scrape with event logging." />
    );
  }
  const dates = daily.map((d) => d.date);
  const claudeCost = daily.map((d) => d.claude_cost_usd);
  const exaCost = daily.map((d) => d.exa_cost_usd);
  const enriched = daily.map((d) => d.roles_enriched);
  const costPerHighFit = daily.map((d) => d.cost_per_high_fit);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <TrendCard
        title="Claude daily cost"
        subtitle={`${fmtUsd(sum(claudeCost))} total`}
        data={claudeCost}
        labels={dates}
        color="blue"
        maxFormatter={(n) => fmtUsd(n)}
      />
      <TrendCard
        title="Exa daily cost"
        subtitle={`${fmtUsd(sum(exaCost))} total`}
        data={exaCost}
        labels={dates}
        color="violet"
        maxFormatter={(n) => fmtUsd(n)}
      />
      <TrendCard
        title="Roles enriched per day"
        subtitle={`${fmtInt(sum(enriched))} total`}
        data={enriched}
        labels={dates}
        color="emerald"
        maxFormatter={(n) => fmtInt(Math.round(n))}
      />
      <TrendCard
        title="Cost per fit≥6 role"
        subtitle="lower is better — trend should be ↓"
        data={costPerHighFit}
        labels={dates}
        color="amber"
        maxFormatter={(n) => fmtUsd(n)}
      />
    </div>
  );
}

function TrendCard({
  title,
  subtitle,
  data,
  labels,
  color,
  maxFormatter,
}: {
  title: string;
  subtitle: string;
  data: Array<number | null>;
  labels: string[];
  color: "blue" | "violet" | "emerald" | "amber";
  maxFormatter?: (n: number) => string;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
      <div className="mb-1 text-[13px] font-medium text-text-primary">{title}</div>
      <div className="mb-3 text-[11px] text-text-muted">{subtitle}</div>
      <Sparkline
        data={data}
        labels={labels}
        color={color}
        width={320}
        height={64}
        showMaxLabel={maxFormatter}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// 5. Pipeline funnel
// -----------------------------------------------------------------------------

export function PipelineFunnel({ totals }: { totals: AggregatedTotals }) {
  const steps = [
    { label: "Discovered", value: totals.roles_discovered },
    { label: "After dedup", value: totals.roles_after_dedup },
    { label: "After filter", value: totals.roles_after_filter },
    { label: "Enriched", value: totals.roles_enriched },
    { label: "High-fit (≥6)", value: totals.roles_fit_6plus },
    { label: "Applied", value: totals.applications_attributed },
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const dropPct = prev && prev > 0 ? 1 - s.value / prev : 0;
        const barW = max > 0 ? (s.value / max) * 100 : 0;
        return (
          <div key={s.label} className="flex items-center gap-3 text-[13px]">
            <div className="w-32 shrink-0 text-text-secondary">{s.label}</div>
            {/* The count lives in its OWN fixed-width cell — it used to sit inside the
                bar, which clipped it whenever the bar was short (e.g. Applied at 4.9%). */}
            <div className="w-20 shrink-0 text-right tabular-nums font-medium text-text-primary">
              {fmtInt(s.value)}
            </div>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: `${barW}%` }}
              />
            </div>
            <div className="w-16 shrink-0 text-right text-[11px] tabular-nums text-text-muted">
              {prev !== null && prev > 0 ? `-${pct(dropPct)}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 6. Tier breakdown
// -----------------------------------------------------------------------------

export function TierBreakdown({ tiers }: { tiers: TierAggregate[] }) {
  if (tiers.length === 0) {
    return (
      <EmptyState
        title="No tier-level events captured yet."
        description="Tier health appears after instrumentation is wired into scan-jobs.mjs (see WORK_LOG_ANALYTICS.md)."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiers.map((t) => (
        <div key={t.tier} className="rounded-lg border border-border-subtle bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[12px] text-text-secondary">{t.tier}</div>
            <Badge color={t.last_exit_status === "ok" ? "emerald" : t.last_exit_status === "error" ? "red" : "neutral"}>
              {t.last_exit_status ?? "—"}
            </Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
            <Metric label="Runs" value={fmtInt(t.runs)} />
            <Metric
              label="Avg dur"
              value={t.runs > 0 ? `${(t.duration_ms / t.runs / 1000).toFixed(1)}s` : "—"}
            />
            <Metric label="Roles" value={fmtInt(t.roles_discovered)} />
            <Metric label="Exa $" value={fmtUsd(t.exa_cost_usd)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="tabular-nums text-text-primary">{value}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 7. Application attribution
// -----------------------------------------------------------------------------

export function ApplicationAttribution({ sources }: { sources: SourceAggregate[] }) {
  const attributed = sources
    .filter((s) => (s.applications_attributed || 0) > 0)
    .sort((a, b) => (b.applications_attributed || 0) - (a.applications_attributed || 0));

  if (attributed.length === 0) {
    return (
      <EmptyState
        title="No applications in this range."
        description="Cross-reference appears once applications.md has entries in Applied / Interview / Offer status overlapping the date range."
      />
    );
  }

  const total = attributed.reduce((s, x) => s + (x.applications_attributed || 0), 0);

  return (
    <div className="text-[13px]">
      <div className="mb-3 text-text-muted">
        {fmtInt(total)} applications cross-referenced to source hosts.{" "}
        <span className="text-text-tertiary">
          (Matched by 6-char company name prefix per SOURCE_PRIORITY convention.)
        </span>
      </div>
      <div className="space-y-2">
        {attributed.map((s) => {
          const apps = s.applications_attributed || 0;
          const share = total > 0 ? apps / total : 0;
          return (
            <div key={s.host} className="flex items-center gap-3">
              <div className="w-48 truncate font-medium text-text-primary">
                <Link
                  href={`/analytics/${encodeURIComponent(s.host)}`}
                  className="hover:text-accent hover:underline"
                >
                  {s.host}
                </Link>
              </div>
              <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-surface-3">
                <div className="absolute inset-y-0 left-0 bg-violet-dim" style={{ width: `${share * 100}%` }} />
              </div>
              <div className="w-24 shrink-0 text-right text-[12px] tabular-nums text-text-secondary">
                {fmtInt(apps)} app{apps === 1 ? "" : "s"} ({pct(share)})
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 8. Auto-promotion log — graceful degrade if Path B hasn't shipped
// -----------------------------------------------------------------------------

export function AutoPromotionLog({ count }: { count: number }) {
  if (count === 0) {
    return (
      <div className="text-[13px] text-text-muted">
        No auto-promotions yet in this range. The <code className="rounded bg-surface-3 px-1 py-0.5 text-[12px] text-text-secondary">promote.applied</code> event fires once an automated promotion pipeline (e.g. Path B&apos;s coverage engine) starts adding companies to <code className="rounded bg-surface-3 px-1 py-0.5 text-[12px] text-text-secondary">companies.yml</code> on its own.
      </div>
    );
  }
  return (
    <div className="text-[13px]">
      <div className="text-text-primary">
        {fmtInt(count)} companies auto-promoted in this range.
      </div>
      <div className="mt-1 text-text-muted">
        Detailed per-promotion log will populate once the promoter writes <code className="rounded bg-surface-3 px-1 py-0.5 text-[12px] text-text-secondary">data/auto-promotions/</code>.
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Shared formatting helpers
// -----------------------------------------------------------------------------

export function fmtUsd(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function fmtInt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function sum(arr: Array<number | null>) {
  let s = 0;
  for (const v of arr) if (typeof v === "number") s += v;
  return s;
}

// Re-export types used by the page shell so it doesn't need its own analytics imports
export type AnomaliesData = { anomalies: SurfacedAnomaly[]; count: number; high_severity_count: number };
export type CompletenessTag = DataCompleteness;
export type AnomalyForRow = Anomaly;
