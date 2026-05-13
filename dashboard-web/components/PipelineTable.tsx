"use client";

import { Fragment, useState, useMemo, useEffect } from "react";
import { ExternalLink, ChevronRight, Search, SkipForward } from "lucide-react";
import type { Role, RoleStatus } from "@/lib/types";
import { ScorePill } from "./ScorePill";
import { StatusDropdown } from "./StatusDropdown";
import { LocationTag } from "./LocationTag";
import { ExpandedRow } from "./ExpandedRow";
import { FilterBar } from "./FilterBar";
import type { Filters } from "./FilterBar";
import { CLUSTER_ORDER } from "@/lib/location-clusters";
import { TableContainer, Th, Tr, EmptyState, Button } from "./ui";

type SortKey = "score" | "company" | "location" | "status" | "firstSeen" | "comp";
type SortDir = "asc" | "desc";

/** Fresh Filters object (own Set) — `minScore` 4 on first mount, 0 when "Clear filters" is pressed. */
function emptyFilters(minScore: number): Filters {
  return {
    search: "",
    status: "all",
    locations: new Set<string>(),
    minScore,
    requireBuild: false,
    requireAI: false,
    hasComp: false,
    includeAggregator: false,
  };
}

interface PipelineTableProps {
  roles: Role[];
  onStatusChange: (url: string, status: RoleStatus) => void;
  onNotesChange: (url: string, notes: string) => void;
}

function daysAgo(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "1d";
  if (diff < 30) return `${diff}d`;
  return `${Math.floor(diff / 30)}mo`;
}

function extractComp(role: Role): string {
  if (role.enrichment?.comp_range && role.enrichment.comp_range !== "Not listed") {
    return role.enrichment.comp_range;
  }
  if (role.comp) return role.comp;
  return "";
}

export function PipelineTable({ roles, onStatusChange, onNotesChange }: PipelineTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filters, setFilters] = useState<Filters>(() => emptyFilters(4));
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [visibleCount, setVisibleCount] = useState(50);

  const sorted = useMemo(() => {
    // Dedupe by URL first — a role surfacing from both the tracker and a scan would
    // otherwise render twice (and collide on the React key). Keep the first occurrence.
    const seen = new Set<string>();
    let filtered = roles.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));

    // Aggregator quarantine — hidden unless the toggle is on
    if (!filters.includeAggregator) {
      filtered = filtered.filter((r) => r.source_tier !== "aggregator");
    }

    // Text search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(
        (r) => r.company.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)
      );
    }

    // Status
    if (filters.status === "stale") filtered = filtered.filter((r) => r.stale);
    else if (filters.status !== "all") filtered = filtered.filter((r) => r.status === filters.status);

    // Location buckets (multi-select)
    if (filters.locations.size > 0) {
      filtered = filtered.filter((r) => filters.locations.has(r.location_cluster || "unknown"));
    }

    // Min score
    if (filters.minScore > 0) {
      filtered = filtered.filter((r) => r.score >= filters.minScore);
    }

    // Build component required
    if (filters.requireBuild) filtered = filtered.filter((r) => r.enrichment?.build_component === true);

    // AI signal required
    if (filters.requireAI) filtered = filtered.filter((r) => r.enrichment?.ai_signal === true);

    // Has comp data
    if (filters.hasComp) filtered = filtered.filter((r) => extractComp(r) !== "");

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "score": cmp = a.score - b.score; break;
        case "company": cmp = a.company.localeCompare(b.company); break;
        case "location": {
          const ai = CLUSTER_ORDER.indexOf(a.location_cluster || "unknown");
          const bi = CLUSTER_ORDER.indexOf(b.location_cluster || "unknown");
          cmp = ai !== bi ? ai - bi : a.location.localeCompare(b.location);
          break;
        }
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "firstSeen": cmp = a.firstSeen.localeCompare(b.firstSeen); break;
        case "comp": cmp = extractComp(a).localeCompare(extractComp(b)); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [roles, sortKey, sortDir, filters]);

  // Reset pagination when the filter set changes — done during render (React's
  // "adjust state when something changes" pattern) rather than in an effect.
  const filtersKey = JSON.stringify([
    filters.search, filters.status, filters.minScore, filters.requireBuild,
    filters.requireAI, filters.hasComp, filters.includeAggregator, [...filters.locations],
  ]);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey);
    setVisibleCount(50);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleSelect(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  }

  function batchAction(status: RoleStatus) {
    for (const url of selectedUrls) onStatusChange(url, status);
    setSelectedUrls(new Set());
  }

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, sorted.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter" && focusIdx >= 0) {
        const role = sorted[focusIdx];
        if (role) setExpandedUrl((prev) => (prev === role.url ? null : role.url));
      }
      if (e.key === "Escape") { setExpandedUrl(null); setFocusIdx(-1); }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [focusIdx, sorted]);

  const columns: { key: SortKey | null; label: string; width: string }[] = [
    { key: null, label: "", width: "w-[44px]" },
    { key: null, label: "", width: "w-[32px]" },
    { key: "score", label: "Score", width: "w-[84px]" },
    { key: "company", label: "Company", width: "w-[16%]" },
    { key: null, label: "Role", width: "w-[22%]" },
    { key: "comp", label: "Comp", width: "w-[12%]" },
    { key: "location", label: "Location", width: "w-[140px]" },
    { key: "status", label: "Status", width: "w-[124px]" },
    { key: "firstSeen", label: "Found", width: "w-[58px]" },
    { key: null, label: "", width: "w-[40px]" },
  ];

  return (
    <div>
      {/* Filter bar */}
      <FilterBar
        roles={roles}
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(emptyFilters(0))}
        resultCount={sorted.length}
      />

      {/* Batch actions */}
      {selectedUrls.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent-border bg-accent-dim px-3 py-2">
          <span className="text-[12px] font-medium text-accent">{selectedUrls.size} selected</span>
          <Button variant="secondary" size="sm" onClick={() => batchAction("Skipped")}>
            <SkipForward size={12} /> Skip all
          </Button>
          <Button variant="primary" size="sm" onClick={() => batchAction("Evaluated")}>
            Evaluate all
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelectedUrls(new Set())}>
            Deselect
          </Button>
        </div>
      )}

      {/* Table */}
      <TableContainer tableClassName="table-fixed">
        <thead className="border-b border-border-subtle bg-surface-1">
          <tr>
            {columns.map((col, i) => (
              <Th
                key={i}
                className={col.width}
                sortDir={col.key ? (sortKey === col.key ? sortDir : false) : undefined}
                onClick={col.key ? () => toggleSort(col.key as SortKey) : undefined}
              >
                {col.label || null}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                <EmptyState
                  icon={<Search size={28} />}
                  title="No roles match your filters"
                  description="Try adjusting them, or clear all filters."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setFilters(emptyFilters(0))}>
                      Clear filters
                    </Button>
                  }
                />
              </td>
            </tr>
          ) : (
            sorted.slice(0, visibleCount).map((role, idx) => {
              const isExpanded = expandedUrl === role.url;
              const isDimmed = role.status === "Rejected" || role.status === "Skipped" || role.stale;
              const isFocused = focusIdx === idx;
              const isSelected = selectedUrls.has(role.url);
              const comp = extractComp(role);
              const hasBuild = role.enrichment?.build_component === true;
              const hasAI = role.enrichment?.ai_signal === true;
              const age = daysAgo(role.firstSeen);

              return (
                <Fragment key={role.url}>
                  <Tr
                    dimmed={isDimmed}
                    focused={isFocused && !isExpanded}
                    className={`cursor-pointer ${
                      isExpanded ? "bg-surface-3" : idx % 2 === 1 ? "bg-surface-row" : ""
                    }`}
                    onClick={() => setExpandedUrl(isExpanded ? null : role.url)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(role.url)}
                        aria-label={`Select ${role.company} — ${role.title}`}
                        className={`h-3.5 w-3.5 cursor-pointer rounded-sm transition-opacity accent-[var(--color-accent-strong)] ${
                          isSelected ? "opacity-100" : "opacity-40"
                        }`}
                      />
                    </td>
                    {/* Expand */}
                    <td className="px-1 py-2.5">
                      <ChevronRight
                        size={13}
                        className={`transition-transform duration-150 ${isExpanded ? "rotate-90 text-accent" : "text-text-muted"}`}
                      />
                    </td>
                    {/* Score + build / AI markers */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <ScorePill
                          score={role.score}
                          provenance={role.scoreProvenance}
                          scoreCapped={role.scoreCapped}
                          overrideReason={role.scoreOverrideReason}
                        />
                        {hasBuild && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" title="Build component" />}
                        {hasAI && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue" title="AI signal" />}
                      </div>
                    </td>
                    {/* Company */}
                    <td className="truncate px-3 py-2.5">
                      {role.company === "Unknown" || role.company === "—" ? (
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(role.title + " job")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-text-muted transition-colors hover:text-accent"
                          title="Search Google"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Unknown <Search size={9} />
                        </a>
                      ) : (
                        <span className="font-medium text-text-primary">{role.company}</span>
                      )}
                    </td>
                    {/* Role */}
                    <td className="truncate px-3 py-2.5 text-text-secondary" title={role.title}>
                      {role.title}
                    </td>
                    {/* Comp — silent when absent: empty cell reads quieter than a wall of em-dashes. */}
                    <td className="truncate px-3 py-2.5 text-[12px] tabular-nums text-text-secondary">
                      {comp}
                    </td>
                    {/* Location */}
                    <td className="px-3 py-2.5"><LocationTag location={role.location} cluster={role.location_cluster} /></td>
                    {/* Status */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <StatusDropdown value={role.status} onChange={(s) => onStatusChange(role.url, s)} />
                    </td>
                    {/* Found (relative) */}
                    <td
                      className={`px-3 py-2.5 text-[11px] tabular-nums ${role.stale ? "text-red" : "text-text-muted"}`}
                      title={role.firstSeen}
                    >
                      {age}
                    </td>
                    {/* Link */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <a
                        href={role.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex text-text-muted transition-colors hover:text-accent"
                        aria-label="Open posting"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </td>
                  </Tr>
                  {isExpanded && (
                    <ExpandedRow role={role} onStatusChange={onStatusChange} onNotesChange={onNotesChange} />
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </TableContainer>

      {/* Show more */}
      {sorted.length > visibleCount && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full justify-center"
          onClick={() => setVisibleCount((v) => v + 50)}
        >
          Show {Math.min(50, sorted.length - visibleCount)} more ({sorted.length - visibleCount} remaining)
        </Button>
      )}

      {/* Keyboard hint */}
      <div className="mt-2 text-[11px] text-text-muted">
        <kbd className="rounded-sm border border-border-subtle bg-surface-3 px-1 py-0.5 text-[10px]">↑↓</kbd> navigate{" "}
        <kbd className="rounded-sm border border-border-subtle bg-surface-3 px-1 py-0.5 text-[10px]">Enter</kbd> expand{" "}
        <kbd className="rounded-sm border border-border-subtle bg-surface-3 px-1 py-0.5 text-[10px]">Esc</kbd> collapse
      </div>
    </div>
  );
}
