"use client";

import { Search, X } from "lucide-react";
import type { Role, RoleStatus } from "@/lib/types";
import { CLUSTER_META, CLUSTER_ORDER } from "@/lib/location-clusters";
import { computeChipCounts } from "../../scripts/lib/chip-counts.mjs";
import { Badge, Button } from "@/components/ui";

const ALL_STATUSES: RoleStatus[] = [
  "Discovered", "Evaluated", "Applied", "Interview", "Offer", "Rejected", "Skipped",
];

interface Filters {
  search: string;
  status: string;
  locations: Set<string>;
  minScore: number;
  requireBuild: boolean;
  requireAI: boolean;
  hasComp: boolean;
  /** Off by default — aggregator-sourced (re-syndicated) roles are hidden until toggled on. */
  includeAggregator: boolean;
}

interface FilterBarProps {
  roles: Role[];
  filters: Filters;
  onChange: (f: Filters) => void;
  /** Reset every filter — wired to "Clear filters" here and to the empty-state button in PipelineTable. */
  onReset: () => void;
  resultCount: number;
}

/** A real 1px vertical rule between chip groups. */
function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border-subtle" />;
}

/** A toggle chip. Active = accent fill + a trailing × (so the active chips *are* the filter pills). */
function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active
          ? "border-accent-border bg-accent-dim text-accent"
          : "border-border-subtle bg-surface-2 text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
      }`}
    >
      {label}
      {count !== undefined && <Badge color="neutral">{count}</Badge>}
      {active && <X size={11} className="shrink-0" />}
    </button>
  );
}

const SCORE_TIERS = [
  { min: 0, label: "All" },
  { min: 4, label: "4+" },
  { min: 6, label: "6+" },
  { min: 8, label: "8+" },
];

export function FilterBar({ roles, filters, onChange, onReset, resultCount }: FilterBarProps) {
  const update = (partial: Partial<Filters>) => onChange({ ...filters, ...partial });

  // Compute counts via the shared pure helper. When the aggregator toggle is
  // OFF (the default), chip counts compute over the non-aggregator subset so
  // the visible chip numbers match the visible table rows.
  const { statusCounts, locBucketCounts, buildCount, aiCount, compCount, staleCount, aggCount } =
    computeChipCounts(roles, {
      includeAggregator: filters.includeAggregator,
      bucketRole: (r: unknown) => ((r as Role).location_cluster || "unknown"),
    }) as {
      statusCounts: Record<string, number>;
      locBucketCounts: Record<string, number>;
      buildCount: number;
      aiCount: number;
      compCount: number;
      staleCount: number;
      aggCount: number;
    };

  const activeFilterCount =
    (filters.status !== "all" ? 1 : 0) +
    (filters.locations.size > 0 ? 1 : 0) +
    (filters.minScore > 0 ? 1 : 0) +
    (filters.requireBuild ? 1 : 0) +
    (filters.requireAI ? 1 : 0) +
    (filters.hasComp ? 1 : 0) +
    (filters.includeAggregator ? 1 : 0) +
    (filters.search ? 1 : 0);

  function toggleLocation(bucket: string) {
    const next = new Set(filters.locations);
    if (next.has(bucket)) next.delete(bucket); else next.add(bucket);
    update({ locations: next });
  }
  function toggleStatus(s: string) {
    update({ status: filters.status === s ? "all" : s });
  }

  return (
    <div className="mb-4 space-y-3">
      {/* Row 1: search · score control · result count · clear */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search companies or roles…"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            className="w-full rounded-md border border-border-subtle bg-surface-2 py-1.5 pl-8 pr-7 text-[13px] text-text-secondary placeholder:text-text-muted"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => update({ search: "" })}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-text-muted transition-colors hover:text-text-secondary"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-border-subtle bg-surface-2 p-0.5">
          {SCORE_TIERS.map((tier) => {
            const active = filters.minScore === tier.min;
            return (
              <button
                key={tier.min}
                type="button"
                onClick={() => update({ minScore: tier.min })}
                aria-pressed={active}
                className={`rounded-sm px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active ? "bg-accent-dim text-accent" : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {tier.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] tabular-nums text-text-muted">
            {resultCount} of {roles.length} roles
          </span>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              <X size={14} /> Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: chip groups — location │ signals │ status │ aggregator */}
      <div className="flex flex-wrap items-center gap-2">
        {CLUSTER_ORDER.filter((k: string) => k === "nyc" || k === "remote" || (locBucketCounts[k] || 0) > 0).map((k: string) => {
          const meta = (CLUSTER_META as Record<string, { label: string; tone: string }>)[k];
          return (
            <Chip
              key={k}
              label={meta.label}
              count={locBucketCounts[k] || 0}
              active={filters.locations.has(k)}
              onClick={() => toggleLocation(k)}
            />
          );
        })}

        <Divider />

        <Chip label="Build" count={buildCount} active={filters.requireBuild} onClick={() => update({ requireBuild: !filters.requireBuild })} />
        <Chip label="AI" count={aiCount} active={filters.requireAI} onClick={() => update({ requireAI: !filters.requireAI })} />
        <Chip label="Has comp" count={compCount} active={filters.hasComp} onClick={() => update({ hasComp: !filters.hasComp })} />

        <Divider />

        {ALL_STATUSES.filter((s) => statusCounts[s]).map((s) => (
          <Chip key={s} label={s} count={statusCounts[s]} active={filters.status === s} onClick={() => toggleStatus(s)} />
        ))}
        {staleCount > 0 && (
          <Chip label="Stale" count={staleCount} active={filters.status === "stale"} onClick={() => toggleStatus("stale")} />
        )}

        {aggCount > 0 && (
          <>
            <Divider />
            <Chip
              label="Aggregator"
              count={aggCount}
              active={filters.includeAggregator}
              onClick={() => update({ includeAggregator: !filters.includeAggregator })}
            />
          </>
        )}
      </div>
    </div>
  );
}

export type { Filters };
