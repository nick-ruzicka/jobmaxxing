"use client";

import { useState } from "react";
import { Building, Search } from "lucide-react";
import type { Company } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { ScorePill } from "@/components/ScorePill";
import { LocationTag } from "@/components/LocationTag";

interface CompaniesPageProps {
  companies: Company[];
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
  activePursuing: number;
}

const TIER_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  watched: { bg: "var(--accent-dim)", text: "var(--accent)", border: "rgba(129,140,248,0.2)", label: "Watched" },
  signal:  { bg: "var(--amber-dim)", text: "var(--amber)", border: "rgba(251,191,36,0.2)", label: "Signal" },
  scan:    { bg: "var(--surface-3)", text: "var(--text-tertiary)", border: "var(--border-subtle)", label: "Scan" },
};

const SIGNAL_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  high:    { bg: "var(--amber-dim)", text: "var(--amber)", border: "rgba(251,191,36,0.2)", label: "High conviction" },
  monitor: { bg: "var(--surface-3)", text: "var(--text-tertiary)", border: "var(--border-subtle)", label: "Monitor" },
  posting: { bg: "var(--emerald-dim)", text: "var(--emerald)", border: "rgba(52,211,153,0.2)", label: "Posting" },
};

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
  const [showMode, setShowMode] = useState<"with-roles" | "signals" | "all">("with-roles");
  const [visibleCount, setVisibleCount] = useState(50);

  const filtered = companies.filter((c) => {
    if (filter && !c.name.toLowerCase().includes(filter.toLowerCase())) return false;
    if (showMode === "with-roles" && c.rolesFound === 0) return false;
    if (showMode === "signals" && !c.signalStatus) return false;
    return true;
  });

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
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Companies</h1>
          <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {companies.length} companies across all sources
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              placeholder="Search companies..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-lg py-2 pl-9 pr-3 text-[13px] placeholder:opacity-40 focus:outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
            />
          </div>
          <div className="flex rounded-lg p-0.5" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
            {([
              { key: "with-roles", label: "With Roles" },
              { key: "signals", label: "Signals Only" },
              { key: "all", label: "All" },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setShowMode(tab.key); setVisibleCount(50); }}
                className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-all"
                style={{
                  background: showMode === tab.key ? "var(--accent-dim)" : "transparent",
                  color: showMode === tab.key ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {filtered.length} companies
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-md)" }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Company</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Source</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Funding</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Roles</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Signal</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, visibleCount).map((company, idx) => {
                const tier = TIER_CONFIG[company.sourceTier] || TIER_CONFIG.scan;
                const signal = company.signalStatus ? SIGNAL_CONFIG[company.signalStatus] : null;
                const isExpanded = expandedSlug === company.slug;

                return (
                  <tr
                    key={company.slug}
                    className="cursor-pointer transition-colors"
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      background: isExpanded ? "var(--surface-3)" : idx % 2 === 1 ? "var(--surface-row)" : "transparent",
                    }}
                    onClick={() => setExpandedSlug(isExpanded ? null : company.slug)}
                    onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "var(--surface-3)"; }}
                    onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = idx % 2 === 1 ? "var(--surface-row, transparent)" : "transparent"; }}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Building size={14} style={{ color: "var(--text-muted)" }} />
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{company.name}</span>
                      </div>
                      {/* Expanded: show roles */}
                      {isExpanded && company.roles.length > 0 && (
                        <div className="ml-6 mt-2 space-y-1.5 animate-expand-in">
                          {company.roles.map((role) => (
                            <a
                              key={role.url}
                              href={role.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-[12px] transition-colors"
                              style={{ color: "var(--text-tertiary)" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ScorePill score={role.score} />
                              <span className="truncate max-w-[200px]" style={{ color: "var(--text-secondary)" }}>{role.title}</span>
                              <LocationTag location={role.location} cluster={role.location_cluster} />
                            </a>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-md"
                        style={{ background: tier.bg, color: tier.text, border: `1px solid ${tier.border}` }}
                      >
                        {tier.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                      {company.funding || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {company.rolesFound}
                    </td>
                    <td className="px-3 py-2.5">
                      {signal && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-md"
                          style={{ background: signal.bg, color: signal.text, border: `1px solid ${signal.border}` }}
                        >
                          {signal.label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {company.lastActivity}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > visibleCount && (
          <button
            onClick={() => setVisibleCount((v) => v + 50)}
            className="mt-3 w-full rounded-lg py-2 text-[12px] font-medium transition-colors"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: "var(--text-tertiary)" }}
          >
            Show {Math.min(50, filtered.length - visibleCount)} more ({filtered.length - visibleCount} remaining)
          </button>
        )}
      </div>
    </Shell>
  );
}
