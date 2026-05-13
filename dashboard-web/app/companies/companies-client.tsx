"use client";

import { useState, useMemo } from "react";
import { Search, Star, X } from "lucide-react";
import type { Company, SignalResult } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { ScorePill } from "@/components/ScorePill";
import { LocationTag } from "@/components/LocationTag";
import { PageHeader, Badge, Button, TableContainer, Th, Tr, EmptyState, SectionLabel, type BadgeColor } from "@/components/ui";

interface CompaniesPageProps {
  companies: Company[];
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
  activePursuing: number;
}

// Source tier — blue=Watched (the deliberate watchlist), amber=Signal-sourced, neutral=found by a scan.
const TIER: Record<Company["sourceTier"], { color: BadgeColor; label: string }> = {
  watched: { color: "blue", label: "Watched" },
  signal: { color: "amber", label: "Signal" },
  scan: { color: "neutral", label: "Scan" },
};

// Signal state — amber=high conviction, emerald=already posting, neutral=just monitoring.
const SIGNAL: Record<SignalResult, { color: BadgeColor; label: string }> = {
  high: { color: "amber", label: "High conviction" },
  posting: { color: "emerald", label: "Posting" },
  monitor: { color: "neutral", label: "Monitor" },
};

const SHOW_MODES = [
  { key: "with-roles", label: "With roles" },
  { key: "signals", label: "Signals only" },
  { key: "all", label: "All" },
] as const;

const ACTIVE_STATUSES = new Set(["Applied", "Interview", "Offer"]);

/** Compute a relevance score for a company — higher = more interesting to the user. */
function relevanceScore(c: Company): number {
  let score = 0;
  for (const role of c.roles) {
    if (role.score >= 7) score += 2;
    else if (role.score >= 4) score += 1;
    if (ACTIVE_STATUSES.has(role.status)) score += 3;
  }
  if (c.sourceTier === "watched") score += 5;
  return score;
}

export function CompaniesPage({
  companies,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
  activePursuing,
}: CompaniesPageProps) {
  const [filter, setFilter] = useState("");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [showMode, setShowMode] = useState<(typeof SHOW_MODES)[number]["key"]>("with-roles");
  const [visibleCount, setVisibleCount] = useState(50);

  // Pre-compute stats for the header.
  const watchedCount = useMemo(() => companies.filter((c) => c.sourceTier === "watched").length, [companies]);
  const activeAppCount = useMemo(
    () => companies.filter((c) => c.roles.some((r) => ACTIVE_STATUSES.has(r.status))).length,
    [companies]
  );

  // Filter + sort with relevance scoring and watched pinning.
  const { watched, rest } = useMemo(() => {
    const filtered = companies.filter((c) => {
      if (filter && !c.name.toLowerCase().includes(filter.toLowerCase())) return false;
      if (showMode === "with-roles" && c.rolesFound === 0) return false;
      if (showMode === "signals" && !c.signalStatus) return false;
      return true;
    });

    // Compute relevance and sort descending.
    const scored = filtered.map((c) => ({ company: c, relevance: relevanceScore(c) }));
    scored.sort((a, b) => b.relevance - a.relevance || a.company.name.localeCompare(b.company.name));

    // Split into watched (pinned top) and rest.
    const watchedItems = scored.filter((s) => s.company.sourceTier === "watched");
    const restItems = scored.filter((s) => s.company.sourceTier !== "watched");

    return { watched: watchedItems, rest: restItems };
  }, [companies, filter, showMode]);

  const totalFiltered = watched.length + rest.length;

  // Drop columns nothing in the dataset populates (keeps the table from being half "—").
  const hasFunding = companies.some((c) => c.funding);
  const hasSignal = companies.some((c) => c.signalStatus);
  const colCount = 4 + (hasFunding ? 1 : 0) + (hasSignal ? 1 : 0);

  function resetFilters() {
    setFilter("");
    setShowMode("all");
    setVisibleCount(50);
  }

  /** Render a company row. */
  function CompanyRow({ company, idx }: { company: Company; idx: number }) {
    const tier = TIER[company.sourceTier] ?? TIER.scan;
    const signal = company.signalStatus ? SIGNAL[company.signalStatus] : null;
    const isExpanded = expandedSlug === company.slug;
    const hasActiveApp = company.roles.some((r) => ACTIVE_STATUSES.has(r.status));
    const isWatched = company.sourceTier === "watched";

    return (
      <Tr
        key={company.slug}
        className={`cursor-pointer [&>td]:align-top ${isExpanded ? "bg-surface-3" : idx % 2 === 1 ? "bg-surface-row" : ""}`}
        onClick={() => setExpandedSlug(isExpanded ? null : company.slug)}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {isWatched && <Star size={12} className="shrink-0 fill-amber text-amber" />}
            <span className="font-medium text-text-primary">{company.name}</span>
          </div>
          {isExpanded && company.roles.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {company.roles.map((role) => (
                <a
                  key={role.url}
                  href={role.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[12px] text-text-tertiary transition-colors hover:text-text-secondary"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ScorePill score={role.score} />
                  <span className="max-w-[220px] truncate text-text-secondary">{role.title}</span>
                  <LocationTag location={role.location} cluster={role.location_cluster} />
                  {ACTIVE_STATUSES.has(role.status) && (
                    <Badge color="blue">{role.status}</Badge>
                  )}
                </a>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5">
          <Badge color={tier.color}>{tier.label}</Badge>
        </td>
        {hasFunding && (
          <td className="px-3 py-2.5 text-[12px] tabular-nums text-text-tertiary">{company.funding || ""}</td>
        )}
        <td className="px-3 py-2.5 text-[12px] tabular-nums text-text-secondary">
          <div className="flex items-center gap-1.5">
            {company.rolesFound}
            {hasActiveApp && <span className="h-1.5 w-1.5 rounded-full bg-blue" title="Active application" />}
          </div>
        </td>
        {hasSignal && (
          <td className="px-3 py-2.5">{signal && <Badge color={signal.color}>{signal.label}</Badge>}</td>
        )}
        <td className="px-3 py-2.5 text-[12px] tabular-nums text-text-muted">{company.lastActivity}</td>
      </Tr>
    );
  }

  // Compute the visible slice across both sections.
  const watchedVisible = watched.slice(0, visibleCount);
  const restBudget = Math.max(0, visibleCount - watched.length);
  const restVisible = rest.slice(0, restBudget);
  const totalVisible = watchedVisible.length + restVisible.length;

  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <PageHeader
        title="Companies"
        subtitle={`${companies.length} companies · ${watchedCount} watched · ${activeAppCount} with active applications`}
      />

      <div className="space-y-4">
        {/* Filter row */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search companies…"
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setVisibleCount(50); }}
              className="w-full rounded-md border border-border-subtle bg-surface-2 py-1.5 pl-8 pr-7 text-[13px] text-text-secondary placeholder:text-text-muted"
            />
            {filter && (
              <button
                type="button"
                onClick={() => { setFilter(""); setVisibleCount(50); }}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-text-muted transition-colors hover:text-text-secondary"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-0.5 rounded-md border border-border-subtle bg-surface-2 p-0.5">
            {SHOW_MODES.map((tab) => {
              const active = showMode === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setShowMode(tab.key); setVisibleCount(50); }}
                  aria-pressed={active}
                  className={`rounded-sm px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    active ? "bg-accent-dim text-accent" : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <span className="ml-auto text-[12px] tabular-nums text-text-muted">
            {totalFiltered} of {companies.length} companies
          </span>
        </div>

        {/* Table */}
        <TableContainer>
          <thead className="border-b border-border-subtle bg-surface-1">
            <tr>
              <Th>Company</Th>
              <Th>Source</Th>
              {hasFunding && <Th>Funding</Th>}
              <Th>Roles</Th>
              {hasSignal && <Th>Signal</Th>}
              <Th>Last activity</Th>
            </tr>
          </thead>
          <tbody>
            {totalFiltered === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <EmptyState
                    icon={<Search size={28} />}
                    title="No companies match"
                    description="Try a different search, or switch the source filter."
                    action={<Button variant="secondary" size="sm" onClick={resetFilters}>Reset filters</Button>}
                  />
                </td>
              </tr>
            ) : (
              <>
                {/* Watched section */}
                {watchedVisible.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={colCount} className="px-3 pt-3 pb-1">
                        <SectionLabel icon={<Star size={11} className="fill-amber text-amber" />}>
                          Watched ({watched.length})
                        </SectionLabel>
                      </td>
                    </tr>
                    {watchedVisible.map((s, idx) => (
                      <CompanyRow key={s.company.slug} company={s.company} idx={idx} />
                    ))}
                  </>
                )}

                {/* Rest section */}
                {restVisible.length > 0 && (
                  <>
                    {watchedVisible.length > 0 && (
                      <tr>
                        <td colSpan={colCount} className="px-3 pt-4 pb-1">
                          <SectionLabel>All companies ({rest.length})</SectionLabel>
                        </td>
                      </tr>
                    )}
                    {restVisible.map((s, idx) => (
                      <CompanyRow key={s.company.slug} company={s.company} idx={idx} />
                    ))}
                  </>
                )}
              </>
            )}
          </tbody>
        </TableContainer>

        {totalFiltered > totalVisible && (
          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-center"
            onClick={() => setVisibleCount((v) => v + 50)}
          >
            Show {Math.min(50, totalFiltered - totalVisible)} more ({totalFiltered - totalVisible} remaining)
          </Button>
        )}
      </div>
    </Shell>
  );
}
