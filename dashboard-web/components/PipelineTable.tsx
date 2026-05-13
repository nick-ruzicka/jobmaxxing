"use client";

import { Fragment, useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ExternalLink,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Search,
  Hammer,
  Cpu,
  SkipForward,
} from "lucide-react";
import type { Role, RoleStatus } from "@/lib/types";
import { ScorePill } from "./ScorePill";
import { StatusDropdown } from "./StatusDropdown";
import { LocationTag } from "./LocationTag";
import { ExpandedRow } from "./ExpandedRow";
import { FilterBar, bucketLocation } from "./FilterBar";
import type { Filters } from "./FilterBar";

type SortKey = "score" | "company" | "location" | "status" | "firstSeen" | "comp";
type SortDir = "asc" | "desc";

const ALL_STATUSES: RoleStatus[] = [
  "Discovered", "Evaluated", "Applied", "Interview", "Offer", "Rejected", "Skipped",
];

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
  const [filters, setFilters] = useState<Filters>({
    search: "",
    status: "all",
    locations: new Set<string>(),
    minScore: 4,
    requireBuild: false,
    requireAI: false,
    hasComp: false,
  });
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [visibleCount, setVisibleCount] = useState(50);
  const tableRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    let filtered = roles;

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
      filtered = filtered.filter((r) => filters.locations.has(bucketLocation(r.location)));
    }

    // Min score
    if (filters.minScore > 0) {
      filtered = filtered.filter((r) => r.score >= filters.minScore);
    }

    // Build component required
    if (filters.requireBuild) {
      filtered = filtered.filter((r) => r.enrichment?.build_component === true);
    }

    // AI signal required
    if (filters.requireAI) {
      filtered = filtered.filter((r) => r.enrichment?.ai_signal === true);
    }

    // Has comp data
    if (filters.hasComp) {
      filtered = filtered.filter((r) => extractComp(r) !== "");
    }

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "score": cmp = a.score - b.score; break;
        case "company": cmp = a.company.localeCompare(b.company); break;
        case "location": cmp = a.location.localeCompare(b.location); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "firstSeen": cmp = a.firstSeen.localeCompare(b.firstSeen); break;
        case "comp": cmp = extractComp(a).localeCompare(extractComp(b)); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [roles, sortKey, sortDir, filters]);

  // Reset pagination when filters change
  const filtersKey = JSON.stringify([filters.search, filters.status, filters.minScore, filters.requireBuild, filters.requireAI, filters.hasComp, [...filters.locations]]);
  useEffect(() => { setVisibleCount(50); }, [filtersKey]);

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
        if (role) setExpandedUrl((prev) => prev === role.url ? null : role.url);
      }
      if (e.key === "Escape") { setExpandedUrl(null); setFocusIdx(-1); }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [focusIdx, sorted]);

  const columns: { key: SortKey | null; label: string; width: string }[] = [
    { key: null, label: "", width: "w-[32px]" },
    { key: null, label: "", width: "w-[28px]" },
    { key: "score", label: "Score", width: "w-[72px]" },
    { key: "company", label: "Company", width: "w-[16%]" },
    { key: null, label: "Role", width: "w-[22%]" },
    { key: "comp", label: "Comp", width: "w-[12%]" },
    { key: "location", label: "Location", width: "w-[11%]" },
    { key: "status", label: "Status", width: "w-[120px]" },
    { key: "firstSeen", label: "Found", width: "w-[56px]" },
    { key: null, label: "", width: "w-[32px]" },
  ];

  return (
    <div>
      {/* Filter bar */}
      <FilterBar roles={roles} filters={filters} onChange={setFilters} resultCount={sorted.length} />

      {/* Batch actions */}
      {selectedUrls.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--accent-dim)", border: "1px solid rgba(129,140,248,0.2)" }}>
          <span className="text-[12px] font-medium" style={{ color: "var(--accent)" }}>{selectedUrls.size} selected</span>
          <button
            onClick={() => batchAction("Skipped")}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{ background: "var(--surface-3)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
          >
            <SkipForward size={11} /> Skip all
          </button>
          <button
            onClick={() => batchAction("Evaluated")}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Evaluate all
          </button>
          <button
            onClick={() => setSelectedUrls(new Set())}
            className="ml-auto text-[11px] transition-colors"
            style={{ color: "var(--text-tertiary)" }}
          >
            Deselect
          </button>
        </div>
      )}

      {/* Table */}
      <div
        ref={tableRef}
        className="overflow-x-auto rounded-lg"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-md)" }}
      >
        <table className="w-full text-[13px] table-fixed">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`px-2 py-2.5 text-left text-[11px] font-medium ${col.width || ""} ${col.key ? "cursor-pointer select-none" : ""}`}
                  style={{ color: "var(--text-muted)" }}
                  onClick={() => col.key && toggleSort(col.key)}
                >
                  {col.label && (
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.key && (
                        sortKey === col.key ? (
                          sortDir === "desc" ? <ChevronDown size={11} style={{ color: "var(--accent)" }} /> : <ChevronUp size={11} style={{ color: "var(--accent)" }} />
                        ) : (
                          <ChevronDown size={11} style={{ color: "var(--border-strong)" }} />
                        )
                      )}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, visibleCount).map((role, idx) => {
              const isExpanded = expandedUrl === role.url;
              const isDimmed = role.status === "Rejected" || role.status === "Skipped" || role.stale;
              const isFocused = focusIdx === idx;
              const isSelected = selectedUrls.has(role.url);
              const rowBg = isExpanded ? "var(--surface-3)" : idx % 2 === 1 ? "var(--surface-row)" : "var(--surface-2)";
              const comp = extractComp(role);
              const hasBuild = role.enrichment?.build_component === true;
              const hasAI = role.enrichment?.ai_signal === true;
              const age = daysAgo(role.firstSeen);

              return (
                <Fragment key={role.url}>
                  <tr
                    className="cursor-pointer transition-colors"
                    style={{
                      borderBottom: isExpanded ? "none" : "1px solid var(--border-subtle)",
                      background: isFocused && !isExpanded ? "var(--surface-3)" : rowBg,
                      opacity: isDimmed ? 0.35 : 1,
                      outline: isFocused ? "1px solid var(--accent)" : "none",
                      outlineOffset: "-1px",
                    }}
                    onClick={() => setExpandedUrl(isExpanded ? null : role.url)}
                    onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "var(--surface-3)"; }}
                    onMouseLeave={(e) => { if (!isExpanded && !isFocused) e.currentTarget.style.background = rowBg; }}
                  >
                    {/* Checkbox */}
                    <td className="w-8 px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(role.url)}
                        className="h-3.5 w-3.5 rounded accent-indigo-500 cursor-pointer"
                        style={{ opacity: isSelected ? 1 : 0.3 }}
                      />
                    </td>
                    {/* Expand */}
                    <td className="w-7 px-1 py-2.5">
                      <ChevronRight
                        size={13}
                        className="transition-transform"
                        style={{
                          transform: isExpanded ? "rotate(90deg)" : "none",
                          color: isExpanded ? "var(--accent)" : "var(--text-muted)",
                          transitionDuration: "var(--duration-fast)",
                        }}
                      />
                    </td>
                    {/* Score + signal dots */}
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <ScorePill score={role.score} />
                        {(hasBuild || hasAI) && (
                          <span className="flex gap-0.5">
                            {hasBuild && (
                              <span title="Build component" className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: "var(--emerald-dim)" }}>
                                <Hammer size={8} style={{ color: "var(--emerald)" }} />
                              </span>
                            )}
                            {hasAI && (
                              <span title="AI signal" className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: "var(--blue-dim)" }}>
                                <Cpu size={8} style={{ color: "var(--blue)" }} />
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Company */}
                    <td className="px-2 py-2.5">
                      {role.company === "Unknown" || role.company === "—" ? (
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(role.title + " job")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 transition-colors"
                          style={{ color: "var(--text-muted)" }}
                          title="Search Google"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Unknown <Search size={9} />
                        </a>
                      ) : (
                        <span className="font-medium" style={{ color: "var(--text-primary)", textDecoration: isDimmed ? "line-through" : "none" }}>
                          {role.company}
                        </span>
                      )}
                    </td>
                    {/* Role */}
                    <td className="px-2 py-2.5 max-w-[220px] truncate" title={role.title} style={{ color: "var(--text-secondary)" }}>
                      {role.title}
                    </td>
                    {/* Comp */}
                    <td className="px-2 py-2.5 text-[12px] tabular-nums" style={{ color: comp ? "var(--text-secondary)" : "var(--text-muted)" }}>
                      {comp || "—"}
                    </td>
                    {/* Location */}
                    <td className="px-2 py-2.5"><LocationTag location={role.location} /></td>
                    {/* Status */}
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <StatusDropdown value={role.status} onChange={(s) => onStatusChange(role.url, s)} />
                    </td>
                    {/* Found (relative) */}
                    <td
                      className="px-2 py-2.5 text-[11px] tabular-nums"
                      style={{ color: role.stale ? "var(--red)" : "var(--text-muted)" }}
                      title={role.firstSeen}
                    >
                      {age}
                    </td>
                    {/* Link */}
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <a
                        href={role.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition-colors"
                        style={{ color: "var(--text-muted)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                      >
                        <ExternalLink size={13} />
                      </a>
                    </td>
                  </tr>
                  {isExpanded && (
                    <ExpandedRow role={role} onStatusChange={onStatusChange} onNotesChange={onNotesChange} />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Empty state */}
        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12" style={{ color: "var(--text-muted)" }}>
            <Search size={24} className="mb-3" style={{ color: "var(--border-strong)" }} />
            <p className="text-[13px]">No roles match your filters</p>
            <p className="text-[11px] mt-1">Try adjusting your filters or clearing them</p>
          </div>
        )}
      </div>

      {/* Show more */}
      {sorted.length > visibleCount && (
        <button
          onClick={() => setVisibleCount((v) => v + 50)}
          className="mt-3 w-full rounded-lg py-2 text-[12px] font-medium transition-colors"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: "var(--text-tertiary)" }}
        >
          Show {Math.min(50, sorted.length - visibleCount)} more ({sorted.length - visibleCount} remaining)
        </button>
      )}

      {/* Keyboard hint */}
      <div className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <kbd className="rounded px-1 py-0.5 text-[10px]" style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}>
          &uarr;&darr;
        </kbd>{" "}
        navigate{" "}
        <kbd className="rounded px-1 py-0.5 text-[10px]" style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}>
          Enter
        </kbd>{" "}
        expand{" "}
        <kbd className="rounded px-1 py-0.5 text-[10px]" style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}>
          Esc
        </kbd>{" "}
        collapse
      </div>
    </div>
  );
}
