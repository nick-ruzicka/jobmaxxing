"use client";

import { X, Hammer, Cpu, MapPin } from "lucide-react";
import type { Role, RoleStatus } from "@/lib/types";
import { CLUSTER_META, CLUSTER_ORDER } from "@/lib/location-clusters";

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
  resultCount: number;
}

function Chip({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all"
      style={{
        background: active ? (color ? color : "var(--accent-dim)") : "var(--surface-2)",
        border: active
          ? `1px solid ${color ? color.replace("0.12)", "0.3)") : "rgba(129,140,248,0.25)"}`
          : "1px solid var(--border-subtle)",
        color: active ? (color ? "var(--text-primary)" : "var(--accent)") : "var(--text-tertiary)",
      }}
    >
      {label}
      {count !== undefined && (
        <span
          className="tabular-nums text-[10px] rounded-full px-1 py-0"
          style={{
            background: active ? "rgba(255,255,255,0.1)" : "var(--surface-3)",
            color: active ? "inherit" : "var(--text-muted)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function FilterBar({ roles, filters, onChange, resultCount }: FilterBarProps) {
  const update = (partial: Partial<Filters>) => onChange({ ...filters, ...partial });

  // Compute counts
  const statusCounts: Record<string, number> = {};
  const locBucketCounts: Record<string, number> = {};
  let buildCount = 0;
  let aiCount = 0;
  let compCount = 0;
  let staleCount = 0;
  let aggCount = 0;

  for (const r of roles) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    const cl = r.location_cluster || "unknown";
    locBucketCounts[cl] = (locBucketCounts[cl] || 0) + 1;
    if (r.enrichment?.build_component) buildCount++;
    if (r.enrichment?.ai_signal) aiCount++;
    if (r.enrichment?.comp_range && r.enrichment.comp_range !== "Not listed") compCount++;
    if (r.comp) compCount++;
    if (r.stale) staleCount++;
    if (r.source_tier === "aggregator") aggCount++;
  }

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

  function clearAll() {
    onChange({
      search: "",
      status: "all",
      locations: new Set(),
      minScore: 0,
      requireBuild: false,
      requireAI: false,
      hasComp: false,
      includeAggregator: false,
    });
  }

  const scoreTiers = [
    { min: 8, label: "8+" },
    { min: 6, label: "6+" },
    { min: 4, label: "4+" },
    { min: 0, label: "All" },
  ];

  return (
    <div className="space-y-3 mb-4">
      {/* Row 1: Search + Score tiers + Result count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            placeholder="Search companies or roles..."
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            className="w-full rounded-lg py-2 pl-3 pr-3 text-[13px] placeholder:opacity-40 focus:outline-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          {scoreTiers.map((tier) => (
            <button
              key={tier.min}
              onClick={() => update({ minScore: filters.minScore === tier.min ? 0 : tier.min })}
              className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-all"
              style={{
                background: filters.minScore === tier.min && tier.min > 0 ? "var(--accent-dim)" : "transparent",
                color: filters.minScore === tier.min && tier.min > 0 ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {tier.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {resultCount} of {roles.length} roles
        </span>

        {activeFilterCount > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 text-[11px] transition-colors"
            style={{ color: "var(--text-tertiary)" }}
          >
            <X size={11} /> Clear filters
          </button>
        )}
      </div>

      {/* Row 2: Location + Status + Signal toggles */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Location chips — cluster-first: one click on "NYC area" answers
            "what's inside my geographic constraint?" */}
        <span className="text-[11px] mr-1" style={{ color: "var(--text-muted)" }}>
          <MapPin size={11} className="inline -mt-0.5" /> Location
        </span>
        {CLUSTER_ORDER.filter((k: string) => k === "nyc" || k === "remote" || (locBucketCounts[k] || 0) > 0).map((k: string) => {
          const meta = (CLUSTER_META as Record<string, { label: string; tone: string }>)[k];
          const color =
            meta.tone === "in-scope" ? "var(--emerald-dim)" :
            meta.tone === "unknown" ? "var(--surface-3)" : undefined;
          return (
            <Chip
              key={k}
              label={meta.label}
              count={locBucketCounts[k] || 0}
              active={filters.locations.has(k)}
              onClick={() => toggleLocation(k)}
              color={color}
            />
          );
        })}

        <span className="mx-1" style={{ color: "var(--border-default)" }}>|</span>

        {/* Signal toggles */}
        <Chip
          label="Build"
          count={buildCount}
          active={filters.requireBuild}
          onClick={() => update({ requireBuild: !filters.requireBuild })}
          color="var(--emerald-dim)"
        />
        <Chip
          label="AI"
          count={aiCount}
          active={filters.requireAI}
          onClick={() => update({ requireAI: !filters.requireAI })}
          color="var(--blue-dim)"
        />
        <Chip
          label="Has Comp"
          count={compCount}
          active={filters.hasComp}
          onClick={() => update({ hasComp: !filters.hasComp })}
        />
        {aggCount > 0 && (
          <Chip
            label="Aggregator"
            count={aggCount}
            active={filters.includeAggregator}
            onClick={() => update({ includeAggregator: !filters.includeAggregator })}
            color="var(--red-dim)"
          />
        )}

        <span className="mx-1" style={{ color: "var(--border-default)" }}>|</span>

        {/* Status chips - only show non-zero */}
        {ALL_STATUSES.filter((s) => statusCounts[s]).map((s) => (
          <Chip
            key={s}
            label={s}
            count={statusCounts[s]}
            active={filters.status === s}
            onClick={() => update({ status: filters.status === s ? "all" : s })}
          />
        ))}
        {staleCount > 0 && (
          <Chip
            label="Stale"
            count={staleCount}
            active={filters.status === "stale"}
            onClick={() => update({ status: filters.status === "stale" ? "all" : "stale" })}
            color="var(--red-dim)"
          />
        )}
      </div>
    </div>
  );
}

export type { Filters };
