"use client";

import { Search, X } from "lucide-react";
import type { Role, RoleStatus } from "@/lib/types";
import { CLUSTER_META, CLUSTER_ORDER } from "@/lib/location-clusters";
import { computeChipCounts } from "../../scripts/lib/chip-counts.mjs";
import { Badge, Button, DropdownPill } from "@/components/ui";
import type { DropdownPillOption } from "@/components/ui";

const ALL_STATUSES: RoleStatus[] = [
  "Discovered", "Evaluated", "Applied", "Interview", "Offer", "Rejected", "Skipped",
];

/** Status → semantic color token for the subtle tint on status chips. */
const STATUS_TINT: Partial<Record<RoleStatus | "stale", string>> = {
  Interview: "border-emerald-border bg-emerald-dim text-emerald",
  Offer:     "border-amber-border bg-amber-dim text-amber",
  Applied:   "border-blue-border bg-blue-dim text-blue",
  Rejected:  "border-red-border bg-red-dim text-red",
};

interface Filters {
  search: string;
  status: string;
  locations: Set<string>;
  minScore: number;
  /** Minimum comp floor in USD (0 = Any). A role passes if its comp midpoint
   *  meets this, or if its comp doesn't parse (unknowns stay visible). */
  minComp: number;
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

/** Tiny uppercase group label — smaller than SectionLabel, inline with chips. */
function GroupLabel({ children }: { children: string }) {
  return (
    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
      {children}
    </span>
  );
}

/** A toggle chip. Active = accent fill + a trailing × (so the active chips *are* the filter pills). */
function Chip({
  label,
  count,
  active,
  onClick,
  tint,
  dataAction,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  /** Optional override classes for the active state (used by status chips). */
  tint?: string;
  dataAction?: string;
}) {
  const activeClass = tint || "border-accent-border bg-accent-dim text-accent";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-action={dataAction}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active
          ? activeClass
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

/** Comp-floor presets. $200K is the configured comp floor (user-context.yaml);
 *  the surrounding tiers bracket it. Judged against the comp range's midpoint. */
const COMP_TIERS = [
  { min: 0, label: "Any" },
  { min: 150000, label: "$150K+" },
  { min: 200000, label: "$200K+" },
  { min: 250000, label: "$250K+" },
];

/** Primary location clusters shown as inline pills. */
const PRIMARY_LOCATIONS = ["nyc", "remote", "sf_bay", "la"];

export function FilterBar({ roles, filters, onChange, onReset, resultCount }: FilterBarProps) {
  const update = (partial: Partial<Filters>) => onChange({ ...filters, ...partial });

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
    (filters.minComp > 0 ? 1 : 0) +
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

  // ── Overflow locations for DropdownPill ──
  const overflowLocations = (CLUSTER_ORDER as string[]).filter(
    (k) => !PRIMARY_LOCATIONS.includes(k) && (locBucketCounts[k] || 0) > 0
  );
  const overflowOptions: DropdownPillOption[] = overflowLocations.map((k) => ({
    id: k,
    label: (CLUSTER_META as Record<string, { label: string }>)[k]?.label || k,
    count: locBucketCounts[k] || 0,
    active: filters.locations.has(k),
  }));
  const overflowActiveCount = overflowLocations.filter((k) => filters.locations.has(k)).length;

  function onOverflowChange(activeIds: string[]) {
    const next = new Set(filters.locations);
    // Remove all overflow keys, then add back what's active.
    for (const k of overflowLocations) next.delete(k);
    for (const id of activeIds) next.add(id);
    update({ locations: next });
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

        <div
          className="flex items-center gap-0.5 rounded-md border border-border-subtle bg-surface-2 p-0.5"
          title="Minimum compensation (judged by the comp range's midpoint)"
        >
          {COMP_TIERS.map((tier) => {
            const active = filters.minComp === tier.min;
            return (
              <button
                key={tier.min}
                type="button"
                data-action={`pipeline:filter_comp_${tier.min}`}
                onClick={() => update({ minComp: tier.min })}
                aria-pressed={active}
                className={`rounded-sm px-3 py-1.5 text-[12px] font-medium tabular-nums transition-colors ${
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

      {/* Row 2: grouped filter chips — Location │ Tags │ Status │ Aggregator */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* ── Location ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          <GroupLabel>Location</GroupLabel>
          {PRIMARY_LOCATIONS.filter((k) => k === "nyc" || k === "remote" || (locBucketCounts[k] || 0) > 0).map((k) => {
            const meta = (CLUSTER_META as Record<string, { label: string }>)[k];
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
          {overflowOptions.length > 0 && (
            <DropdownPill
              label="More"
              count={overflowActiveCount || undefined}
              options={overflowOptions}
              onChange={onOverflowChange}
            />
          )}
        </div>

        {/* ── Tags ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          <GroupLabel>Tags</GroupLabel>
          <Chip label="Build" count={buildCount} active={filters.requireBuild} onClick={() => update({ requireBuild: !filters.requireBuild })} />
          <Chip label="AI" count={aiCount} active={filters.requireAI} onClick={() => update({ requireAI: !filters.requireAI })} />
          <Chip label="Has comp" count={compCount} active={filters.hasComp} onClick={() => update({ hasComp: !filters.hasComp })} />
        </div>

        {/* ── Status ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          <GroupLabel>Status</GroupLabel>
          {ALL_STATUSES.filter((s) => statusCounts[s]).map((s) => (
            <Chip
              key={s}
              label={s === "Skipped" ? "Hidden / Skipped" : s}
              count={statusCounts[s]}
              active={filters.status === s}
              onClick={() => toggleStatus(s)}
              tint={STATUS_TINT[s]}
              dataAction={`pipeline:filter_${s.toLowerCase()}`}
            />
          ))}
          {staleCount > 0 && (
            <Chip
              label="Stale"
              count={staleCount}
              active={filters.status === "stale"}
              onClick={() => toggleStatus("stale")}
            />
          )}
        </div>

        {/* ── Aggregator (separate) ── */}
        {aggCount > 0 && (
          <Chip
            label="Aggregator"
            count={aggCount}
            active={filters.includeAggregator}
            onClick={() => update({ includeAggregator: !filters.includeAggregator })}
          />
        )}
      </div>
    </div>
  );
}

export type { Filters };
