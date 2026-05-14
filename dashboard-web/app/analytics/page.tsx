"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

import {
  HeroMetrics,
  AnomaliesPanel,
  SourcePerformance,
  CostTrends,
  PipelineFunnel,
  TierBreakdown,
  ApplicationAttribution,
  AutoPromotionLog,
} from "./sections";
import { CollapsibleSection } from "./CollapsibleSection";
import type {
  AggregatedTotals,
  SourceAggregate,
  TierAggregate,
  DailySeries,
  SurfacedAnomaly,
} from "@/lib/analytics";

type Range = "7d" | "30d" | "60d" | "90d";

interface AnalyticsResponse {
  range: Range;
  totals: AggregatedTotals;
  by_source: SourceAggregate[];
  by_tier: TierAggregate[];
  by_date: DailySeries[];
  rollup_count: number;
}

interface AnomaliesResponse {
  range: Range;
  count: number;
  high_severity_count: number;
  anomalies: SurfacedAnomaly[];
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [anomalies, setAnomalies] = useState<AnomaliesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, a] = await Promise.all([
        fetch(`/api/analytics?range=${range}`).then((r) => r.json()),
        fetch(`/api/analytics/anomalies?range=7d`).then((r) => r.json()),
      ]);
      setData(d);
      setAnomalies(a);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const id = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  const reconstructedCount = useMemo(() => {
    if (!data) return 0;
    return data.by_date.filter((d) => d.data_completeness === "reconstructed").length;
  }, [data]);

  const autoPromoteCount = useMemo(() => data?.totals.auto_promotions || 0, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BarChart3 className="h-4 w-4 text-text-tertiary" />}
        title="Analytics"
        actions={
          <>
            <span className="hidden text-[12px] tabular-nums text-text-tertiary sm:inline">
              {lastUpdated ? `Refreshed ${formatTime(lastUpdated)}` : "loading…"}
            </span>
            <RangeChips value={range} onChange={setRange} />
            <Button variant="secondary" onClick={fetchAll}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-border bg-red-dim/40 p-3 text-[13px] text-red">
          Failed to load analytics: {error}
        </div>
      )}

      {!data && loading && (
        <EmptyState title={`Loading ${range} of analytics…`} />
      )}

      {data && (
        <>
          {reconstructedCount > 0 && (
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Badge color="neutral">historical</Badge>
              {reconstructedCount} of {data.by_date.length} days in this range are reconstructed
              from existing state files (no event log yet — see WORK_LOG_ANALYTICS.md).
            </div>
          )}

          {/* ──────────────────────────────────────────────────────────────────
              ABOVE THE FOLD — always visible, no collapse.
              These are the three things you need to read in one glance:
              what the totals are, what's broken, what the funnel looks like.
              ────────────────────────────────────────────────────────────── */}

          <HeroMetrics totals={data.totals} />

          {anomalies && <AnomaliesPanel anomalies={anomalies.anomalies} />}

          <CollapsibleSection
            id="funnel"
            title="Pipeline funnel"
            subtitle={`${data.totals.roles_discovered.toLocaleString()} → ${data.totals.applications_attributed.toLocaleString()} over ${range}`}
            defaultOpen
          >
            <PipelineFunnel totals={data.totals} />
          </CollapsibleSection>

          {/* ──────────────────────────────────────────────────────────────────
              BELOW THE FOLD — collapsible, open/closed state persists in
              localStorage so morning-Nick's preferences stick across sessions.
              ────────────────────────────────────────────────────────────── */}

          <CollapsibleSection
            id="cost-trends"
            title="Cost trends"
            subtitle={`${data.by_date.length} days · total ${fmtUsdHeader(data.totals.total_cost_usd)}`}
            defaultOpen
          >
            <CostTrends daily={data.by_date} />
          </CollapsibleSection>

          <CollapsibleSection
            id="source-perf"
            title="Source performance"
            count={data.by_source.length}
            subtitle={
              data.by_source[0]
                ? `top: ${data.by_source[0].host} (${Math.round(
                    (data.by_source[0].hit_rate_fit_6plus || 0) * 100,
                  )}% hit)`
                : undefined
            }
          >
            <SourcePerformance sources={data.by_source} />
          </CollapsibleSection>

          <CollapsibleSection
            id="tier-health"
            title="Tier health"
            count={data.by_tier.length}
          >
            <TierBreakdown tiers={data.by_tier} />
          </CollapsibleSection>

          <CollapsibleSection
            id="app-attribution"
            title="Application attribution"
            count={data.totals.applications_attributed}
            subtitle={
              data.totals.applications_attributed > 0
                ? `across ${data.by_source.filter((s) => (s.applications_attributed || 0) > 0).length} sources`
                : undefined
            }
            defaultOpen={data.totals.applications_attributed > 0}
          >
            <ApplicationAttribution sources={data.by_source} />
          </CollapsibleSection>

          <CollapsibleSection
            id="auto-promo"
            title="Auto-promotion log"
            count={autoPromoteCount || undefined}
          >
            <AutoPromotionLog count={autoPromoteCount} />
          </CollapsibleSection>
        </>
      )}
    </div>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtUsdHeader(n: number): string {
  if (Math.abs(n) >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function RangeChips({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const opts: Range[] = ["7d", "30d", "60d", "90d"];
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface-2 p-0.5">
      {opts.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            onClick={() => onChange(r)}
            className={
              active
                ? "rounded-md border border-accent-border bg-accent-dim px-2.5 py-1 text-[12px] font-medium text-accent"
                : "rounded-md border border-transparent px-2.5 py-1 text-[12px] text-text-tertiary hover:text-text-secondary"
            }
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}
