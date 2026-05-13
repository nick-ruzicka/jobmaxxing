"use client";

import { Flame, Eye, Radio, ArrowRight, ExternalLink } from "lucide-react";
import type { Signal } from "@/lib/types";
import { Shell } from "@/components/Shell";

interface SignalsPageProps {
  warmLeads: Signal[];
  monitoring: Signal[];
  posting: Signal[];
  totalSignals: number;
  highConviction: number;
  companyCount: number;
  signalCount: number;
  hasWarmLeads: boolean;
  activePursuing: number;
}

export function SignalsPage({
  warmLeads,
  monitoring,
  posting,
  totalSignals,
  highConviction,
  companyCount,
  signalCount,
  hasWarmLeads,
  activePursuing,
}: SignalsPageProps) {
  return (
    <Shell
      activePursuing={activePursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signalCount}
      hasWarmLeads={hasWarmLeads}
    >
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Signals</h1>
          <div className="flex items-center gap-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
            <span>{totalSignals} tracked</span>
            <span>{highConviction} high conviction</span>
            <span>{posting.length} posting</span>
          </div>
        </div>

        {/* High Conviction */}
        {warmLeads.length > 0 && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[12px] font-medium" style={{ color: "var(--amber)" }}>
              <Flame size={14} />
              High Conviction ({warmLeads.length})
            </h2>
            <div className="grid gap-2">
              {warmLeads.map((s) => (
                <div
                  key={s.slug}
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", borderLeft: "2px solid var(--amber)" }}
                >
                  <div>
                    <div className="font-medium" style={{ color: "var(--text-primary)" }}>{s.name}</div>
                    <div className="flex items-center gap-2 mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                      {s.amount && (
                        <span className="rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: "var(--amber-dim)", color: "var(--amber)", border: "1px solid rgba(251,191,36,0.2)" }}>
                          {s.amount}
                        </span>
                      )}
                      Checked {s.lastChecked}
                    </div>
                  </div>
                  <button className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors" style={{ background: "var(--amber-dim)", color: "var(--amber)", border: "1px solid rgba(251,191,36,0.2)" }}>
                    Reach out <ArrowRight size={11} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Already Posting */}
        {posting.length > 0 && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[12px] font-medium" style={{ color: "var(--emerald)" }}>
              <Radio size={14} />
              Already Posting ({posting.length})
            </h2>
            <div className="grid gap-2">
              {posting.map((s) => (
                <div
                  key={s.slug}
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", borderLeft: "2px solid var(--emerald)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: "var(--text-primary)" }}>{s.name}</span>
                    {s.amount && <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{s.amount}</span>}
                  </div>
                  <span className="rounded-md px-2 py-0.5 text-[11px]" style={{ background: "var(--emerald-dim)", color: "var(--emerald)", border: "1px solid rgba(52,211,153,0.2)" }}>
                    Posting detected
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Monitor */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>
            <Eye size={14} />
            Monitor ({monitoring.length})
          </h2>
          <div className="overflow-x-auto rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}>
                  <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Company</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Funding</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Last Checked</th>
                </tr>
              </thead>
              <tbody>
                {[...monitoring].sort((a, b) => {
                  const amtA = parseFloat((a.amount || "0").replace(/[^0-9.]/g, "")) || 0;
                  const amtB = parseFloat((b.amount || "0").replace(/[^0-9.]/g, "")) || 0;
                  return amtB - amtA;
                }).map((s, idx) => (
                  <tr
                    key={s.slug}
                    style={{ borderBottom: "1px solid var(--border-subtle)", background: idx % 2 === 1 ? "var(--surface-row)" : "transparent" }}
                    className="transition-colors"
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 1 ? "var(--surface-row)" : "transparent"; }}
                  >
                    <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{s.name}</td>
                    <td className="px-3 py-2 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>{s.amount || "—"}</td>
                    <td className="px-3 py-2 text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>{s.lastChecked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Shell>
  );
}
