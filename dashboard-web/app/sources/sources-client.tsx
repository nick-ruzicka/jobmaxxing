"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  DollarSign,
  Wrench,
  ArchiveX,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import type { SourceHealthRow, SourceHealthSummary, SourceStatus } from "@/lib/types";
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
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

const STATUS_META: Record<SourceStatus, { label: string; color: string; bg: string }> = {
  healthy: { label: "Healthy", color: "var(--emerald)", bg: "var(--emerald-dim)" },
  "broken-extractor": { label: "Broken: extractor", color: "var(--amber)", bg: "var(--amber-dim)" },
  "broken-scrape": { label: "Broken: scrape", color: "var(--red)", bg: "var(--red-dim)" },
  quarantined: { label: "Quarantined", color: "var(--violet)", bg: "var(--violet-dim)" },
  "spam-blocked": { label: "Spam-blocked", color: "var(--text-muted)", bg: "var(--surface-3)" },
};

const STATUS_ORDER: SourceStatus[] = [
  "broken-extractor",
  "broken-scrape",
  "healthy",
  "quarantined",
  "spam-blocked",
];

function StatusBadge({ status }: { status: SourceStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className="rounded-md px-2 py-0.5 text-[11px] whitespace-nowrap font-medium"
      style={{ color: m.color, background: m.bg, border: `1px solid color-mix(in srgb, ${m.color} 25%, transparent)` }}
    >
      {m.label}
    </span>
  );
}

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

// ---------------------------------------------------------------------------
// Table column model
// ---------------------------------------------------------------------------
type SortKey =
  | "host"
  | "totalUrls"
  | "enrichmentRate"
  | "avgFit"
  | "hitRate"
  | "hasCompCoverage"
  | "recoverableCount"
  | "scrapeFailures"
  | "lastSeen"
  | "status";

// Column labels are deliberately user-facing — engineer-language ("Enriched", "Hit ≥6")
// has been swapped for verbs and outcomes that answer "is this source working?" first.
const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; sortable: boolean }[] = [
  { key: "host", label: "Source host", align: "left", sortable: true },
  { key: "totalUrls", label: "Total URLs", align: "right", sortable: true },
  { key: "enrichmentRate", label: "Working", align: "right", sortable: true },
  { key: "avgFit", label: "Quality score", align: "right", sortable: true },
  { key: "hitRate", label: "Good matches", align: "right", sortable: true },
  { key: "hasCompCoverage", label: "Pay data found", align: "right", sortable: true },
  { key: "recoverableCount", label: "Could recover", align: "right", sortable: true },
  { key: "scrapeFailures", label: "Failed fetches", align: "right", sortable: true },
  { key: "lastSeen", label: "Last seen", align: "right", sortable: true },
];
const COL_COUNT = COLUMNS.length + 2; // + Status + Issue

function sortVal(r: SourceHealthRow, key: SortKey): string | number {
  switch (key) {
    case "host":
      return r.host;
    case "totalUrls":
      return r.totalUrls;
    case "enrichmentRate":
      return r.enrichmentRate;
    case "avgFit":
      return r.avgFit ?? -1;
    case "hitRate":
      return r.hitRate ?? -1;
    case "hasCompCoverage":
      return r.hasCompCoverage;
    case "recoverableCount":
      return r.auditFinding ? r.recoverableCount : -1;
    case "scrapeFailures":
      return r.scrapeFailures;
    case "lastSeen":
      return r.lastSeen || "";
    case "status":
      // Position in STATUS_ORDER — lower index = higher priority. Ascending sort
      // surfaces broken-extractor → broken-scrape → healthy → quarantined → spam-blocked,
      // which is "are my sources working?" in row order.
      return STATUS_ORDER.indexOf(r.status);
  }
}

function num(n: number | null, fmt: (x: number) => string, fallback = "—") {
  return n === null ? fallback : fmt(n);
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
  // Default: sort by status (asc → broken first) so the page leads with what
  // needs attention, not the largest host alphabetically.
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState<SourceStatus | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter]
  );

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sortVal(a, sortKey);
      const vb = sortVal(b, sortKey);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      if (cmp === 0) cmp = b.totalUrls - a.totalUrls; // stable-ish secondary
      return cmp * dir;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // host / lastSeen / status default to ascending — alphabetical-first for host,
      // chronological-first for lastSeen, broken-first for status.
      setSortDir(key === "host" || key === "lastSeen" || key === "status" ? "asc" : "desc");
    }
  }

  function toggleExpand(host: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  }

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

        {/* Summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard icon={<Activity size={18} />} value={summary.totalSources} label="Sources" sub={`${summary.totalEnriched} enriched`} color="var(--accent)" dim="var(--accent-dim)" />
          <StatCard icon={<ShieldCheck size={18} />} value={summary.healthySources} label="Healthy" color="var(--emerald)" dim="var(--emerald-dim)" />
          <StatCard icon={<AlertTriangle size={18} />} value={summary.brokenSources} label="Broken" sub="extractor + scrape" color="var(--amber)" dim="var(--amber-dim)" />
          <StatCard icon={<DollarSign size={18} />} value={pct(summary.overallCompCoverage)} label="Comp today" sub={`${summary.totalHasComp}/${summary.totalEnriched}`} color="var(--blue)" dim="var(--blue-dim)" />
          <StatCard icon={<Wrench size={18} />} value={`~${pct(summary.overallProjectedCoverage)}`} label="Projected" sub={`+${summary.overallRecoverable} active roles`} color="var(--violet)" dim="var(--violet-dim)" />
        </div>
        <div className="text-[11px] flex items-start gap-1.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
          <ArchiveX size={12} className="mt-px shrink-0" />
          <span>
            {summary.quarantinedSources} quarantined &middot; {summary.spamBlockedSources} spam-blocked — not counted in the healthy/broken tallies.
            The headline projection ({pct(summary.overallCompCoverage)} &rarr; ~{pct(summary.overallProjectedCoverage)}) covers the <strong>active pipeline only</strong>;
            +~{summary.additionalRecoverableQuarantined} additional roles recoverable on quarantined/aggregator hosts (via Fix 5b — currently excluded from the default scan path),
            +~{summary.additionalRecoverableSpam} on spam-blocked hosts.
          </span>
        </div>

        {/* Status filter chips */}
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <button
            onClick={() => setStatusFilter("all")}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all"
            style={{
              background: statusFilter === "all" ? "var(--accent-dim)" : "var(--surface-2)",
              border: statusFilter === "all" ? "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" : "1px solid var(--border-subtle)",
              color: statusFilter === "all" ? "var(--accent)" : "var(--text-tertiary)",
            }}
          >
            All
            <span className="tabular-nums text-[10px] rounded-full px-1" style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}>{rows.length}</span>
          </button>
          {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => {
            const m = STATUS_META[s];
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(active ? "all" : s)}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all"
                style={{
                  background: active ? m.bg : "var(--surface-2)",
                  border: `1px solid ${active ? `color-mix(in srgb, ${m.color} 35%, transparent)` : "var(--border-subtle)"}`,
                  color: active ? m.color : "var(--text-tertiary)",
                }}
              >
                {m.label}
                <span className="tabular-nums text-[10px] rounded-full px-1" style={{ background: active ? "rgba(255,255,255,0.08)" : "var(--surface-3)", color: active ? "inherit" : "var(--text-muted)" }}>{statusCounts[s]}</span>
              </button>
            );
          })}
          <span className="ml-auto text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{sorted.length} of {rows.length} sources</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}>
                <th className="w-6" />
                {COLUMNS.map((c) => {
                  const active = sortKey === c.key;
                  return (
                    <th
                      key={c.key}
                      className={`px-3 py-2.5 text-[11px] font-medium ${c.align === "right" ? "text-right" : "text-left"} ${c.sortable ? "cursor-pointer select-none" : ""}`}
                      style={{ color: active ? "var(--text-secondary)" : "var(--text-muted)" }}
                      onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.align === "right" && active && (sortDir === "desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
                        {c.label}
                        {c.align === "left" && active && (sortDir === "desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
                      </span>
                    </th>
                  );
                })}
                <th
                  className="px-3 py-2.5 text-left text-[11px] font-medium cursor-pointer select-none"
                  style={{ color: sortKey === "status" ? "var(--text-secondary)" : "var(--text-muted)" }}
                  onClick={() => toggleSort("status")}
                >
                  <span className="inline-flex items-center gap-1">
                    Status
                    {sortKey === "status" && (sortDir === "desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
                  </span>
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Issue</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, idx) => {
                const open = expanded.has(r.host);
                const af = r.auditFinding;
                return (
                  <FragmentRow key={r.host}>
                    <tr
                      onClick={() => toggleExpand(r.host)}
                      className="cursor-pointer transition-colors"
                      style={{ borderBottom: open ? "none" : "1px solid var(--border-subtle)", background: idx % 2 === 1 ? "var(--surface-row)" : "transparent" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 1 ? "var(--surface-row)" : "transparent"; }}
                    >
                      <td className="pl-3" style={{ color: "var(--text-muted)" }}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                      <td className="px-3 py-2 font-medium" style={{ color: "var(--text-secondary)" }}>{r.host}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{r.totalUrls}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        {r.enrichedReal}
                        <span className="ml-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{pct(r.enrichmentRate)}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-tertiary)" }}>{num(r.avgFit, (x) => x.toFixed(1))}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-tertiary)" }}>{num(r.hitRate, pct)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.hasCompCoverage > 0 ? "var(--text-secondary)" : "var(--text-muted)" }}>
                        {r.hasCompCount}
                        <span className="ml-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{pct(r.hasCompCoverage)}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: af && r.recoverableCount > 0 ? "var(--violet)" : "var(--text-muted)" }}>
                        {af ? `+${r.recoverableCount}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.scrapeFailures > 0 ? "var(--red)" : "var(--text-muted)" }}>{r.scrapeFailures || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[12px]" style={{ color: "var(--text-muted)" }}>{r.lastSeen || "—"}</td>
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 text-[12px] max-w-[26ch] truncate" style={{ color: "var(--text-muted)" }} title={af?.diagnosis || "Not yet audited"}>
                        {af ? `${af.fixId !== "—" ? `Fix #${af.fixId} — ` : ""}${af.diagnosis}` : "Not yet audited"}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={COL_COUNT} style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--border-subtle)" }}>
                          <div className="animate-expand-in px-8 py-4 space-y-3 text-[13px]">
                            <DetailBlock label="Issue">
                              {af ? af.diagnosis : (
                                <span style={{ color: "var(--text-muted)" }}>Not yet audited — run the comp audit on a sample of this host before relying on its recoverable estimate.</span>
                              )}
                            </DetailBlock>
                            <DetailBlock label="Proposed fix">
                              {af && af.fixId !== "—" ? (
                                <span>
                                  <span className="rounded-md px-1.5 py-0.5 text-[11px] mr-2" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>Fix #{af.fixId}</span>
                                  {af.fixLabel}
                                  <span className="ml-2 rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: "var(--surface-3)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>{af.compSourceTarget}</span>
                                </span>
                              ) : af ? (
                                <span style={{ color: "var(--text-muted)" }}>{af.fixLabel}</span>
                              ) : (
                                <span style={{ color: "var(--text-muted)" }}>—</span>
                              )}
                            </DetailBlock>
                            <DetailBlock label="Before / after">
                              {af && r.recoverableCount > 0 ? (
                                <span>
                                  Comp coverage <strong style={{ color: "var(--text-primary)" }}>{pct1(r.hasCompCoverage)}</strong> today
                                  {" → "}<strong style={{ color: "var(--violet)" }}>~{pct1(r.projectedCompCoverage)}</strong>
                                  {af.fixId !== "—" ? ` after Fix #${af.fixId}` : ""} (+~{r.recoverableCount} roles on this host)
                                </span>
                              ) : (
                                <span style={{ color: "var(--text-muted)" }}>
                                  Comp coverage {pct1(r.hasCompCoverage)} today — no material recovery projected{af ? "" : " (not audited)"}.
                                </span>
                              )}
                            </DetailBlock>
                            {af && af.sampleUrls.length > 0 && (
                              <DetailBlock label="Sample URLs in this state">
                                <ul className="space-y-1">
                                  {af.sampleUrls.map((u) => (
                                    <li key={u}>
                                      <a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: "var(--accent)" }}>
                                        <ExternalLink size={11} /> {u}
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              </DetailBlock>
                            )}
                            {r.sourceTags.length > 0 && (
                              <DetailBlock label="Discovery sources">
                                <div className="flex flex-wrap gap-1">
                                  {r.sourceTags.map((t) => (
                                    <span key={t} className="rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: "var(--surface-3)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>{t}</span>
                                  ))}
                                </div>
                              </DetailBlock>
                            )}
                            <div className="text-[11px] tabular-nums pt-1" style={{ color: "var(--text-muted)" }}>
                              {r.enrichedReal} enriched · {r.scrapeFailures} scrape failures · avg fit {num(r.avgFit, (x) => x.toFixed(1))} · hit rate {num(r.hitRate, pct)} · last seen {r.lastSeen || "—"}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={COL_COUNT} className="px-3 py-6 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>No sources match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div style={{ color: "var(--text-secondary)" }}>{children}</div>
    </div>
  );
}

// Tiny wrapper so we can return two <tr>s per row without an extra DOM node.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
